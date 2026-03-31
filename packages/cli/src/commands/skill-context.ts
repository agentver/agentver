import { existsSync, readFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { readManifest } from '../storage/manifest.js'

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
  if (sourceUri.startsWith('agentver://')) {
    const withoutProtocol = sourceUri.slice('agentver://'.length)
    const atIndex = withoutProtocol.lastIndexOf('@')
    const pathPart = atIndex > 0 ? withoutProtocol.slice(0, atIndex) : withoutProtocol
    return pathPart.split('/').filter(Boolean)[0] ?? null
  }

  const cleaned = sourceUri
    .replace(/^[a-z]+:\/\//i, '')
    .split('@')[0]
    ?.split('#')[0]
    ?.split('?')[0]

  const parts = cleaned?.split('/').filter(Boolean) ?? []
  if (parts.length >= 2) {
    return parts[parts.length - 2] ?? null
  }

  return parts[0] ?? null
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
