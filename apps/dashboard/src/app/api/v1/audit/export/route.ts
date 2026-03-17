import { prisma } from '@agentver/database'
import { createLogger } from '@agentver/shared'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { authenticateRequest } from '@/lib/auth/api-auth'

const logger = createLogger('audit-export')

const MAX_EXPORT_RECORDS = 10_000

const querySchema = z.object({
  orgSlug: z.string().min(1),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  format: z.enum(['csv', 'json']).default('csv'),
})

function escapeCSVField(field: string): string {
  if (field.includes(',') || field.includes('"') || field.includes('\n')) {
    return `"${field.replace(/"/g, '""')}"`
  }
  return field
}

export async function GET(request: Request) {
  const authResult = await authenticateRequest(request)
  if (!authResult) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  const url = new URL(request.url)
  const rawParams = {
    orgSlug: url.searchParams.get('orgSlug'),
    from: url.searchParams.get('from'),
    to: url.searchParams.get('to'),
    format: url.searchParams.get('format') ?? 'csv',
  }

  const parsed = querySchema.safeParse(rawParams)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    )
  }

  const { orgSlug, from, to, format } = parsed.data

  const org = await prisma.organisation.findUnique({
    where: { slug: orgSlug },
    select: { id: true },
  })

  if (!org) {
    return NextResponse.json({ error: 'Organisation not found' }, { status: 404 })
  }

  const membership = await prisma.organisationMember.findUnique({
    where: {
      userId_organisationId: {
        userId: authResult.userId,
        organisationId: org.id,
      },
    },
    select: { role: true },
  })

  if (!membership || (membership.role !== 'ADMIN' && membership.role !== 'OWNER')) {
    return NextResponse.json(
      { error: 'Only organisation admins and owners can export audit logs' },
      { status: 403 }
    )
  }

  const fromDate = new Date(`${from}T00:00:00.000Z`)
  const toDate = new Date(`${to}T23:59:59.999Z`)

  if (fromDate > toDate) {
    return NextResponse.json(
      { error: 'The "from" date must be before the "to" date' },
      { status: 400 }
    )
  }

  const memberIds = await prisma.organisationMember
    .findMany({
      where: { organisationId: org.id },
      select: { userId: true },
    })
    .then((members) => members.map((m) => m.userId))

  const logs = await prisma.auditLog.findMany({
    where: {
      userId: { in: memberIds },
      createdAt: { gte: fromDate, lte: toDate },
    },
    orderBy: { createdAt: 'desc' },
    take: MAX_EXPORT_RECORDS,
    include: {
      user: { select: { name: true, email: true } },
    },
  })

  logger.info('Audit log export', {
    orgSlug,
    format,
    count: logs.length,
    userId: authResult.userId,
  })

  if (format === 'json') {
    const jsonRows = logs.map((log) => ({
      timestamp: log.createdAt.toISOString(),
      actor: log.user?.name ?? log.user?.email ?? 'system',
      action: log.action,
      resource: log.resource,
      resourceId: log.resourceId ?? '',
      metadata: log.metadata ?? {},
    }))

    return NextResponse.json(jsonRows, {
      headers: {
        'Content-Disposition': `attachment; filename="audit-${orgSlug}-${from}-to-${to}.json"`,
      },
    })
  }

  const csvHeaders = ['timestamp', 'actor', 'action', 'resource', 'resourceId', 'metadata']
  const csvRows = logs.map((log) => {
    const actor = log.user?.name ?? log.user?.email ?? 'system'
    const metadataStr = log.metadata ? JSON.stringify(log.metadata) : ''

    return [
      log.createdAt.toISOString(),
      escapeCSVField(actor),
      log.action,
      log.resource,
      log.resourceId ?? '',
      escapeCSVField(metadataStr),
    ].join(',')
  })

  const csvContent = [csvHeaders.join(','), ...csvRows].join('\n')

  return new Response(csvContent, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="audit-${orgSlug}-${from}-to-${to}.csv"`,
    },
  })
}
