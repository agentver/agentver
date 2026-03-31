import { existsSync, readFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { readManifest } from '../storage/manifest.js'

const ORG_SLUG_REGEX = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i

export type SkillNamespace = {
  org: string
  name: string
}

type ResolveNamespaceOptions = {
  projectRoot?: string
  skillDir?: string
  skillName?: string
  org?: string
  fallbackToPath?: boolean
}

type ResolveCurrentSkillIdentityOptions = {
  nameArg?: string
  projectRoot?: string
  cwd?: string
  fallbackToPath?: boolean
}

export function detectSkillName(skillDir: string): string | null {
  const skillMdPath = join(skillDir, 'SKILL.md')
  if (!existsSync(skillMdPath)) {
    return null
  }

  const content = readFileSync(skillMdPath, 'utf-8')
  const nameMatch = content.match(/^name:\s*(.+)$/m)
  return nameMatch?.[1]?.trim() ?? basename(skillDir)
}

export function extractOrgFromSourceUri(sourceUri: string): string | null {
  const trimmedSourceUri = sourceUri.trim()
  if (!trimmedSourceUri) {
    return null
  }

  if (trimmedSourceUri.startsWith('agentver://')) {
    const withoutProtocol =
      trimmedSourceUri.slice('agentver://'.length).split('#')[0]?.split('?')[0] ?? ''
    const firstSegment = withoutProtocol.split('/').filter(Boolean)[0] ?? ''
    return toValidOrgSlug(firstSegment.split('@')[0])
  }

  try {
    const parsed = new URL(trimmedSourceUri)
    const pathSegments = parsed.pathname.split('/').filter(Boolean)
    return toValidOrgSlug(pathSegments[0])
  } catch {}

  const sshPath = trimmedSourceUri.match(/^[^@/]+@[^:]+:(.+)$/)?.[1]
  const cleaned = (sshPath ?? trimmedSourceUri).split('#')[0]?.split('?')[0] ?? ''
  const parts = cleaned.split(/[\\/]/).filter(Boolean)

  if (parts.length >= 2) {
    const candidate = parts[0]?.includes('.') || parts[0]?.includes(':') ? parts[1] : parts[0]
    return toValidOrgSlug(candidate)
  }

  return toValidOrgSlug(parts[0])
}

export function resolveNamespace(options: ResolveNamespaceOptions): SkillNamespace | null {
  const projectRoot = options.projectRoot ?? process.cwd()
  const skillDir = options.skillDir ? resolve(options.skillDir) : process.cwd()
  const skillName = options.skillName ?? detectSkillName(skillDir) ?? basename(skillDir)

  if (options.org) {
    return { org: options.org, name: skillName }
  }

  const manifest = readManifest(projectRoot)
  const entry = manifest.packages[skillName]

  if (entry?.source.type === 'git') {
    const org = extractOrgFromSourceUri(entry.source.uri)
    if (org) {
      return { org, name: skillName }
    }
  }

  if (options.fallbackToPath !== false) {
    const pathParts = skillDir.split('/')
    const skillsIndex = pathParts.lastIndexOf('skills')
    if (skillsIndex >= 0 && pathParts.length > skillsIndex + 2) {
      const org = pathParts[skillsIndex + 1]
      if (org) {
        return { org, name: skillName }
      }
    }
  }

  return null
}

export function resolveCurrentSkillIdentity(
  options: ResolveCurrentSkillIdentityOptions = {}
): SkillNamespace | null {
  const cwd = options.cwd ?? process.cwd()
  const skillName =
    options.nameArg ??
    (() => {
      const detected = detectSkillName(cwd)
      return detected ?? basename(cwd)
    })()

  return resolveNamespace({
    projectRoot: options.projectRoot ?? process.cwd(),
    skillDir: cwd,
    skillName,
    fallbackToPath: options.fallbackToPath,
  })
}

function toValidOrgSlug(candidate: string | null | undefined): string | null {
  const normalised = candidate?.trim().replace(/^@/, '') ?? ''
  if (!normalised || !ORG_SLUG_REGEX.test(normalised)) {
    return null
  }
  return normalised
}
