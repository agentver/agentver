import { createHmac, timingSafeEqual } from 'node:crypto'
import { prisma } from '@agentver/database'
import { createLogger } from '@agentver/shared'
import { NextResponse } from 'next/server'
import { identifyAgentFromPath } from '@/lib/scanner/config-scanner'
import { bumpPatchVersion } from '@/lib/sources/upstream'
import { deliverEvent } from '@/lib/webhooks/service'

const logger = createLogger('webhook:github')

const SKILL_PATH_PATTERNS = [
  '.claude/skills/',
  '.cursor/skills/',
  '.agents/skills/',
  '.github/skills/',
  'skills/',
]

const SKILL_CONFIG_FILES = ['CLAUDE.md', 'AGENTS.md', 'SKILL.md', '.cursorrules', '.windsurfrules']

type PushEventPayload = {
  ref: string
  after: string
  repository: {
    full_name: string
    owner: { login: string }
    name: string
  }
  commits: Array<{
    added: string[]
    modified: string[]
    removed: string[]
  }>
}

function verifySignature(payload: string, signature: string | null): boolean {
  const secret = process.env.GITHUB_WEBHOOK_SECRET
  if (!secret || !signature) {
    return false
  }

  const expectedSignature = `sha256=${createHmac('sha256', secret).update(payload).digest('hex')}`

  try {
    return timingSafeEqual(Buffer.from(signature, 'utf8'), Buffer.from(expectedSignature, 'utf8'))
  } catch {
    return false
  }
}

function isSkillRelatedPath(filePath: string): boolean {
  const isInSkillDir = SKILL_PATH_PATTERNS.some((pattern) => filePath.startsWith(pattern))
  if (isInSkillDir) return true

  const isConfigFile = SKILL_CONFIG_FILES.some(
    (config) => filePath === config || filePath.endsWith(`/${config}`)
  )
  if (isConfigFile) return true

  const identified = identifyAgentFromPath(filePath)
  return identified !== null
}

function extractChangedSkillFiles(payload: PushEventPayload): string[] {
  const changedFiles = new Set<string>()

  for (const commit of payload.commits) {
    for (const file of [...commit.added, ...commit.modified]) {
      if (isSkillRelatedPath(file)) {
        changedFiles.add(file)
      }
    }
  }

  return [...changedFiles]
}

async function fetchFileFromGitHub(
  accessToken: string,
  owner: string,
  repo: string,
  path: string,
  ref: string
): Promise<string | null> {
  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}?ref=${ref}`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/vnd.github.v3.raw',
      },
    }
  )

  if (!response.ok) {
    logger.warn('Failed to fetch file from GitHub', {
      path,
      status: response.status,
    })
    return null
  }

  return response.text()
}

/**
 * Find an access token for the repo by looking up connected accounts
 * belonging to members of the organisation that owns this skills repo.
 */
async function findAccessTokenForRepo(repoOwner: string, repoName: string): Promise<string | null> {
  const org = await prisma.organisation.findFirst({
    where: {
      skillsRepoOwner: { equals: repoOwner, mode: 'insensitive' },
      skillsRepoName: { equals: repoName, mode: 'insensitive' },
    },
    include: {
      members: {
        take: 5,
        select: { userId: true },
      },
    },
  })

  if (!org || org.members.length === 0) return null

  const account = await prisma.connectedAccount.findFirst({
    where: {
      userId: { in: org.members.map((m) => m.userId) },
      provider: 'GITHUB',
    },
    select: { accessToken: true },
  })

  return account?.accessToken ?? null
}

/**
 * When files change in a skills repo, for each matching Package:
 * 1. Update the readme from SKILL.md
 * 2. Create a new PackageVersion (auto-incremented patch)
 * 3. Fire a `skill.updated` webhook event
 * 4. Notify the package author
 */
async function syncPackagesFromPush(
  repoOwner: string,
  repoName: string,
  ref: string,
  commitSha: string,
  changedFiles: string[],
  accessToken: string
): Promise<{ updated: number; notified: number }> {
  let updated = 0
  let notified = 0

  // Find all packages in organisations that use this repo as their skills repo
  const packages = await prisma.package.findMany({
    where: {
      organisation: {
        skillsRepoOwner: { equals: repoOwner, mode: 'insensitive' },
        skillsRepoName: { equals: repoName, mode: 'insensitive' },
      },
      gitPath: { not: null },
    },
    select: {
      id: true,
      name: true,
      slug: true,
      gitPath: true,
      authorId: true,
      organisationId: true,
    },
  })

  if (packages.length === 0) return { updated, notified }

  // Build a lookup: normalised gitPath -> packages
  const packagesByPath = new Map<string, typeof packages>()
  for (const pkg of packages) {
    if (!pkg.gitPath) continue
    const normPath = pkg.gitPath.replace(/^\/+/, '')
    const existing = packagesByPath.get(normPath) ?? []
    existing.push(pkg)
    packagesByPath.set(normPath, existing)
  }

  // Deduplicate: only process each package once per push
  const processedPackageIds = new Set<string>()

  // For each changed file, check if it belongs to a package's gitPath
  for (const filePath of changedFiles) {
    const matchingPackages: typeof packages = []

    for (const [gitPath, pkgs] of packagesByPath) {
      if (filePath.startsWith(`${gitPath}/`) || filePath === gitPath) {
        matchingPackages.push(...pkgs)
      }
    }

    if (matchingPackages.length === 0) continue

    for (const pkg of matchingPackages) {
      if (processedPackageIds.has(pkg.id)) continue
      processedPackageIds.add(pkg.id)
      const normPath = (pkg.gitPath ?? '').replace(/^\/+/, '')
      const skillFilePath = normPath ? `${normPath}/SKILL.md` : 'SKILL.md'

      try {
        const content = await fetchFileFromGitHub(
          accessToken,
          repoOwner,
          repoName,
          skillFilePath,
          ref
        )

        if (content) {
          await prisma.package.update({
            where: { id: pkg.id },
            data: { readme: content },
          })
        }

        // Create a new PackageVersion with an auto-incremented patch version
        const latestVersion = await prisma.packageVersion.findFirst({
          where: { packageId: pkg.id },
          orderBy: { createdAt: 'desc' },
          select: { version: true },
        })

        const nextVersion = bumpPatchVersion(latestVersion?.version ?? '0.0.0')

        const newVersion = await prisma.packageVersion.create({
          data: {
            packageId: pkg.id,
            version: nextVersion,
            changelog: 'Synced from upstream push',
            gitRef: ref,
            gitCommitSha: commitSha,
          },
        })

        logger.info('Created package version from webhook push', {
          packageSlug: pkg.slug,
          version: newVersion.version,
          filePath: skillFilePath,
          commitSha,
        })
        updated++

        // Fire webhook event (fire-and-forget)
        void deliverEvent(
          pkg.organisationId,
          'skill.updated',
          { id: 'system', username: 'github-webhook' },
          {
            packageId: pkg.id,
            name: pkg.name,
            version: newVersion.version,
          }
        )

        // Send upstream-changed notification to the author
        await prisma.notification
          .create({
            data: {
              userId: pkg.authorId,
              type: 'UPSTREAM_CHANGED',
              title: `Skill "${pkg.name}" updated via Git`,
              body: `A push to ${repoOwner}/${repoName} (${ref}) changed files in ${normPath}`,
              resourceId: pkg.id,
              resourceType: 'package',
            },
          })
          .catch((err) => {
            logger.warn('Failed to create upstream changed notification', {
              packageId: pkg.id,
              error: err instanceof Error ? err.message : String(err),
            })
          })

        notified++
      } catch (error) {
        logger.error('Failed to sync package from push', {
          packageSlug: pkg.slug,
          filePath: skillFilePath,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
  }

  return { updated, notified }
}

export async function POST(request: Request): Promise<NextResponse> {
  if (!process.env.GITHUB_WEBHOOK_SECRET) {
    logger.error('GITHUB_WEBHOOK_SECRET is not configured — rejecting all webhook requests')
    return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 500 })
  }

  const event = request.headers.get('x-github-event')
  const signature = request.headers.get('x-hub-signature-256')
  const deliveryId = request.headers.get('x-github-delivery')

  const rawBody = await request.text()

  if (!verifySignature(rawBody, signature)) {
    logger.warn('Invalid webhook signature', { deliveryId })
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  logger.info('Received GitHub webhook', { event, deliveryId })

  if (event === 'ping') {
    return NextResponse.json({ message: 'pong' })
  }

  if (event === 'push') {
    let payload: PushEventPayload
    try {
      payload = JSON.parse(rawBody) as PushEventPayload
    } catch {
      return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
    }

    const { owner, name } = payload.repository
    const repoOwner = owner.login
    const repoName = name
    const ref = payload.ref.replace('refs/heads/', '')
    const commitSha = payload.after

    const changedFiles = extractChangedSkillFiles(payload)

    if (changedFiles.length === 0) {
      logger.debug('No skill-related files changed', { repoOwner, repoName })
      return NextResponse.json({ message: 'No skill files changed' })
    }

    logger.info('Skill-related files changed', {
      repoOwner,
      repoName,
      fileCount: changedFiles.length,
      files: changedFiles,
    })

    const accessToken = await findAccessTokenForRepo(repoOwner, repoName)

    if (!accessToken) {
      logger.debug('No access token found for repo', { repoOwner, repoName })
      return NextResponse.json({ message: 'No connected accounts for this repo' })
    }

    const { updated, notified } = await syncPackagesFromPush(
      repoOwner,
      repoName,
      ref,
      commitSha,
      changedFiles,
      accessToken
    )

    logger.info('Webhook processing complete', {
      repoOwner,
      repoName,
      updatedPackages: updated,
      notifiedAuthors: notified,
    })

    return NextResponse.json({
      message: 'Processed',
      updatedPackages: updated,
      notifiedAuthors: notified,
    })
  }

  // Return 200 for all unhandled events to prevent GitHub retries
  return NextResponse.json({ message: 'Event not handled' })
}
