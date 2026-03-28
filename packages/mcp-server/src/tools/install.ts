import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import {
  type AgentId,
  detectInstalledAgents,
  getSkillPlacementPath,
} from '@agentver/agent-definitions'
import { AgentverError } from '@agentver/shared'
import type { GitSource } from '@agentver/shared'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import * as z from 'zod/v4'
import { getWorkingDirectory } from '../shared/context'
import { isAuthenticated, registryFetch } from '../shared/registry'
import { readLockfile, readManifest, writeLockfile, writeManifest } from '../storage'

type DownloadResponse = {
  version: string
  content: string | null
  fileManifest: Record<string, unknown> | Array<{ path: string; content: string }>
  sha256: string | null
  size: number | null
  gitRef: string | null
  gitCommitSha: string | null
  gitUri: string | null
  gitPath: string | null
  createdAt: string
}

type VersionListResponse = {
  versions: Array<{
    version: string
    status: string
  }>
}

const SAFE_PACKAGE_NAME = /^[a-zA-Z0-9][a-zA-Z0-9._-]*\/[a-zA-Z0-9][a-zA-Z0-9._-]*$/

function assertPathWithin(filePath: string, baseDir: string): void {
  const resolved = resolve(filePath)
  const resolvedBase = resolve(baseDir)
  if (!resolved.startsWith(`${resolvedBase}/`) && resolved !== resolvedBase) {
    throw new AgentverError(
      'VALIDATION_ERROR',
      `Path traversal detected: "${filePath}" escapes base directory`
    )
  }
}

function expandTilde(path: string): string {
  return path.replace(/^~/, homedir())
}

function extractFilesFromManifest(
  fileManifest: Record<string, unknown> | unknown[]
): Array<{ path: string; content: string }> {
  if (Array.isArray(fileManifest)) {
    return fileManifest.filter(
      (entry): entry is { path: string; content: string } => {
        if (typeof entry !== 'object' || entry === null) return false
        const record = entry as Record<string, unknown>
        return typeof record.path === 'string' && typeof record.content === 'string'
      }
    )
  }

  return Object.entries(fileManifest)
    .filter(([, value]) => typeof value === 'string')
    .map(([path, content]) => ({ path, content: content as string }))
}

function computeIntegrity(files: Array<{ path: string; content: string }>): string {
  const sorted = [...files].sort((a, b) => a.path.localeCompare(b.path))
  const combined = sorted.map((f) => `${f.path}\0${f.content}`).join('\0')
  const hash = createHash('sha256').update(combined).digest('base64')
  return `sha256-${hash}`
}

async function resolveLatestVersion(org: string, name: string): Promise<string> {
  const data = await registryFetch<VersionListResponse>(
    `/skills/${encodeURIComponent(org)}/${encodeURIComponent(name)}/versions`
  )

  const available = data.versions.filter((v) => v.status !== 'YANKED')
  if (available.length === 0) {
    throw new AgentverError('NOT_FOUND', `No published versions found for ${org}/${name}`)
  }

  return available[0]!.version
}

export function registerInstallTool(server: McpServer): void {
  server.registerTool(
    'agentver_install',
    {
      title: 'Agentver Install',
      description:
        'Install a package from the Agentver registry into the current project. ' +
        'Resolves the version, downloads files, places them into detected agent directories, ' +
        'and updates the manifest and lockfile.',
      inputSchema: z.object({
        package: z
          .string()
          .describe('Package name in org/name format (e.g. "my-org/typescript-rules")'),
        version: z
          .string()
          .optional()
          .describe('Semver version to install (e.g. "1.2.0"). Defaults to latest if omitted'),
        agents: z
          .array(z.string())
          .optional()
          .describe(
            'Target agent IDs to install for (e.g. ["claude-code", "cursor"]). Omit to auto-detect installed agents'
          ),
        global: z
          .boolean()
          .optional()
          .describe(
            'Set to true to install globally for all projects instead of current project only'
          ),
      }),
    },
    async ({ package: packageName, version, agents: targetAgents, global: isGlobal }) => {
      if (!isAuthenticated()) {
        throw new AgentverError(
          'UNAUTHORISED',
          'Not authenticated. Run `agentver login` in your terminal first.'
        )
      }

      if (!SAFE_PACKAGE_NAME.test(packageName)) {
        throw new AgentverError(
          'VALIDATION_ERROR',
          `Invalid package name "${packageName}". Must be in org/name format using alphanumeric characters, hyphens, dots, or underscores.`
        )
      }

      const [org, name] = packageName.split('/') as [string, string]
      const projectRoot = getWorkingDirectory()

      const resolvedVersion = version ?? (await resolveLatestVersion(org, name))

      const data = await registryFetch<DownloadResponse>(
        `/skills/${encodeURIComponent(org)}/${encodeURIComponent(name)}/${encodeURIComponent(resolvedVersion)}/download`
      )

      // Validate required fields before any file I/O
      if (!data.gitUri || !data.gitRef || !data.gitCommitSha || !data.sha256) {
        throw new AgentverError(
          'VALIDATION_ERROR',
          `Registry response for ${packageName}@${data.version} is missing required fields (git provenance or sha256) for manifest v2.`
        )
      }

      const files = extractFilesFromManifest(data.fileManifest)

      if (files.length === 0) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Package ${packageName}@${data.version} has no files in its file manifest.`,
            },
          ],
        }
      }

      const detectedAgents = targetAgents ?? detectInstalledAgents(projectRoot).map((a) => a.id)

      if (detectedAgents.length === 0) {
        return {
          content: [
            {
              type: 'text' as const,
              text: 'No AI agents detected in this project. Specify target agents explicitly or ensure agent config directories exist.',
            },
          ],
        }
      }

      const shortName = name
      const installedTo: string[] = []

      for (const agentId of detectedAgents) {
        const placementPath = getSkillPlacementPath(
          agentId as AgentId,
          shortName,
          isGlobal ? 'global' : 'project'
        )
        if (!placementPath) continue

        const fullPath = isGlobal ? expandTilde(placementPath) : join(projectRoot, placementPath)

        const baseDir = isGlobal ? homedir() : projectRoot
        assertPathWithin(fullPath, baseDir)

        if (!existsSync(fullPath)) {
          mkdirSync(fullPath, { recursive: true })
        }

        const resolvedBase = resolve(fullPath)

        for (const file of files) {
          if (file.path.includes('..')) {
            console.warn(`Skipping file with path traversal segment: '${file.path}'`)
            continue
          }

          const filePath = resolve(fullPath, file.path)
          if (!filePath.startsWith(`${resolvedBase}/`) && filePath !== resolvedBase) {
            console.warn(`Skipping file that escapes target directory: '${file.path}'`)
            continue
          }

          const dir = dirname(filePath)
          if (!existsSync(dir)) {
            mkdirSync(dir, { recursive: true })
          }
          writeFileSync(filePath, file.content, 'utf-8')
        }

        installedTo.push(agentId)
      }

      // Shared source for both manifest and lockfile v2 entries
      const source: GitSource = {
        type: 'git',
        uri: data.gitUri,
        path: data.gitPath ?? '',
        ref: data.gitRef,
        commit: data.gitCommitSha,
      }

      // Update manifest
      const root = isGlobal ? homedir() : projectRoot
      const manifest = readManifest(root)
      manifest.packages[packageName] = {
        source,
        agents: installedTo,
        installedAt: new Date().toISOString(),
        modified: false,
      }
      writeManifest(root, manifest)

      // Update lockfile
      const lockfile = readLockfile(root)
      lockfile.packages[packageName] = {
        source,
        integrity: `sha256-${data.sha256}`,
        agents: installedTo,
      }
      writeLockfile(root, lockfile)

      const summary = [
        `Installed ${packageName}@${data.version}`,
        `Target agents: ${installedTo.join(', ')}`,
        `Files: ${files.length} file(s) placed`,
        `Scope: ${isGlobal ? 'global' : 'project'}`,
      ]

      return {
        content: [{ type: 'text' as const, text: summary.join('\n') }],
      }
    }
  )
}
