import { prisma } from '@agentver/database'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { logAudit } from '@/lib/audit/logger'
import { authenticateRequestWithDetails } from '@/lib/auth/api-auth'
import { decryptToken, encryptToken, TokenDecryptionError } from '@/lib/crypto/token-encryption'

// ---------------------------------------------------------------------------
// GET /api/v1/vault — List secrets (metadata only)
// ---------------------------------------------------------------------------

export async function GET(request: Request) {
  const authResponse = await authenticateRequestWithDetails(request)
  if (!authResponse.ok) {
    return NextResponse.json(
      { error: authResponse.error.message },
      { status: authResponse.error.status }
    )
  }

  const { organisationId } = authResponse.result

  if (!organisationId) {
    return NextResponse.json(
      { error: 'Organisation context required. Use an organisation-scoped API key.' },
      { status: 400 }
    )
  }

  const url = new URL(request.url)
  const teamId = url.searchParams.get('teamId')

  const secrets = await prisma.secretVault.findMany({
    where: {
      organisationId,
      ...(teamId ? { teamId } : {}),
    },
    select: {
      id: true,
      key: true,
      description: true,
      sharing: true,
      rotationDays: true,
      lastRotatedAt: true,
      expiresAt: true,
      teamId: true,
      createdAt: true,
      updatedAt: true,
    },
    orderBy: { key: 'asc' },
  })

  return NextResponse.json({ secrets })
}

// ---------------------------------------------------------------------------
// POST /api/v1/vault — Set or retrieve secrets
// ---------------------------------------------------------------------------

const setSecretSchema = z.object({
  action: z.literal('set'),
  key: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[a-z0-9-]+$/),
  value: z.string().min(1).max(10_000),
  description: z.string().max(500).default(''),
  teamId: z.string().nullish(),
  sharing: z.enum(['INDIVIDUAL', 'TEAM', 'ORG']).default('INDIVIDUAL'),
  rotationDays: z.number().int().positive().max(365).optional(),
})

const getSecretSchema = z.object({
  action: z.literal('get'),
  key: z.string().min(1),
  teamId: z.string().nullish(),
})

const getBulkSchema = z.object({
  action: z.literal('get-bulk'),
  keys: z.array(z.string()).min(1).max(50),
  teamId: z.string().nullish(),
})

const rotateSecretSchema = z.object({
  action: z.literal('rotate'),
  key: z.string().min(1),
  newValue: z.string().min(1).max(10_000),
  teamId: z.string().nullish(),
})

const requestSchema = z.discriminatedUnion('action', [
  setSecretSchema,
  getSecretSchema,
  getBulkSchema,
  rotateSecretSchema,
])

export async function POST(request: Request) {
  const authResponse = await authenticateRequestWithDetails(request)
  if (!authResponse.ok) {
    return NextResponse.json(
      { error: authResponse.error.message },
      { status: authResponse.error.status }
    )
  }

  const { userId, organisationId } = authResponse.result

  if (!organisationId) {
    return NextResponse.json(
      { error: 'Organisation context required. Use an organisation-scoped API key.' },
      { status: 400 }
    )
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = requestSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request', details: parsed.error.flatten() },
      { status: 400 }
    )
  }

  const input = parsed.data

  switch (input.action) {
    case 'set': {
      // Verify org membership and admin role
      const membership = await prisma.organisationMember.findUnique({
        where: { userId_organisationId: { userId, organisationId } },
      })

      if (
        !membership ||
        !(['OWNER', 'ADMIN'] as const).includes(membership.role as 'OWNER' | 'ADMIN')
      ) {
        return NextResponse.json(
          { error: 'Only org admins and owners can set vault secrets' },
          { status: 403 }
        )
      }

      const encryptedValue = encryptToken(input.value)

      const secret = await prisma.secretVault.upsert({
        where: {
          organisationId_teamId_key: {
            organisationId,
            teamId: input.teamId ?? '',
            key: input.key,
          },
        },
        create: {
          organisationId,
          teamId: input.teamId ?? null,
          key: input.key,
          description: input.description,
          encryptedValue,
          sharing: input.sharing,
          rotationDays: input.rotationDays,
          lastRotatedAt: new Date(),
          createdById: userId,
        },
        update: {
          description: input.description,
          encryptedValue,
          sharing: input.sharing,
          rotationDays: input.rotationDays,
          lastRotatedAt: new Date(),
        },
        select: { id: true, key: true, sharing: true },
      })

      logAudit({
        userId,
        action: 'SECRET_CREATED',
        resource: 'SecretVault',
        resourceId: secret.id,
        metadata: { key: input.key, organisationId },
      })

      return NextResponse.json({ ok: true, key: secret.key, id: secret.id })
    }

    case 'get': {
      const secret = await prisma.secretVault.findUnique({
        where: {
          organisationId_teamId_key: {
            organisationId,
            teamId: input.teamId ?? '',
            key: input.key,
          },
        },
      })

      if (!secret) {
        return NextResponse.json({ error: `Secret "${input.key}" not found` }, { status: 404 })
      }

      // Access control
      const accessError = await checkSecretAccess(secret, userId)
      if (accessError) {
        return NextResponse.json({ error: accessError }, { status: 403 })
      }

      if (secret.expiresAt && secret.expiresAt < new Date()) {
        return NextResponse.json({ error: 'Secret has expired' }, { status: 410 })
      }

      try {
        const value = decryptToken(secret.encryptedValue)

        prisma.secretAccessLog
          .create({ data: { secretId: secret.id, userId, action: 'read' } })
          .catch(() => {})

        return NextResponse.json({ key: secret.key, value })
      } catch (error) {
        if (error instanceof TokenDecryptionError) {
          return NextResponse.json({ error: 'Failed to decrypt secret' }, { status: 500 })
        }
        throw error
      }
    }

    case 'get-bulk': {
      const secrets = await prisma.secretVault.findMany({
        where: {
          organisationId,
          key: { in: input.keys },
          OR: [{ teamId: input.teamId ?? null }, { teamId: null }],
        },
      })

      const results: Array<{ key: string; value: string }> = []
      const denied: string[] = []
      const missing: string[] = []

      for (const secret of secrets) {
        const accessError = await checkSecretAccess(secret, userId)
        if (accessError) {
          denied.push(secret.key)
          continue
        }

        if (secret.expiresAt && secret.expiresAt < new Date()) {
          denied.push(secret.key)
          continue
        }

        try {
          const value = decryptToken(secret.encryptedValue)
          results.push({ key: secret.key, value })

          prisma.secretAccessLog
            .create({ data: { secretId: secret.id, userId, action: 'read' } })
            .catch(() => {})
        } catch {
          denied.push(secret.key)
        }
      }

      const foundKeys = new Set([...results.map((r) => r.key), ...denied])
      for (const key of input.keys) {
        if (!foundKeys.has(key)) {
          missing.push(key)
        }
      }

      return NextResponse.json({ secrets: results, denied, missing })
    }

    case 'rotate': {
      const membership = await prisma.organisationMember.findUnique({
        where: { userId_organisationId: { userId, organisationId } },
      })

      if (
        !membership ||
        !(['OWNER', 'ADMIN'] as const).includes(membership.role as 'OWNER' | 'ADMIN')
      ) {
        return NextResponse.json(
          { error: 'Only org admins and owners can rotate vault secrets' },
          { status: 403 }
        )
      }

      const secret = await prisma.secretVault.findUnique({
        where: {
          organisationId_teamId_key: {
            organisationId,
            teamId: input.teamId ?? '',
            key: input.key,
          },
        },
      })

      if (!secret) {
        return NextResponse.json({ error: `Secret "${input.key}" not found` }, { status: 404 })
      }

      const encryptedValue = encryptToken(input.newValue)

      await prisma.secretVault.update({
        where: { id: secret.id },
        data: { encryptedValue, lastRotatedAt: new Date() },
      })

      prisma.secretAccessLog
        .create({ data: { secretId: secret.id, userId, action: 'rotate' } })
        .catch(() => {})

      logAudit({
        userId,
        action: 'SECRET_ROTATED',
        resource: 'SecretVault',
        resourceId: secret.id,
        metadata: { key: input.key, organisationId },
      })

      return NextResponse.json({ ok: true, key: input.key })
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type SecretRecord = {
  sharing: string
  createdById: string
  teamId: string | null
}

async function checkSecretAccess(secret: SecretRecord, userId: string): Promise<string | null> {
  switch (secret.sharing) {
    case 'INDIVIDUAL':
      if (secret.createdById !== userId) {
        return 'This secret is only accessible by its creator'
      }
      break

    case 'TEAM':
      if (secret.teamId) {
        const teamMember = await prisma.teamMember.findUnique({
          where: { teamId_userId: { teamId: secret.teamId, userId } },
        })
        if (!teamMember) {
          return 'You are not a member of the team that owns this secret'
        }
      }
      break

    case 'ORG':
      break
  }

  return null
}
