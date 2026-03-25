import type { Dirent } from 'node:fs'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { createLogger } from '@agentver/shared'
import { getLogLevel } from '../output.js'
import type { FetchedFile, GitSource } from './types.js'

const logger = createLogger('git:cache', getLogLevel())

export function getCacheDir(): string {
  return join(homedir(), '.agentver', 'cache')
}

export function getRepoCacheDir(source: GitSource): string {
  return join(getCacheDir(), source.host, source.owner, source.repo)
}

export function getCachedFiles(source: GitSource, commitSha: string): FetchedFile[] | null {
  const commitDir = join(getRepoCacheDir(source), 'commits', commitSha)
  const basePath = source.path || '.'

  const targetDir = basePath === '.' ? commitDir : join(commitDir, basePath)

  if (!existsSync(targetDir)) return null

  try {
    const files = readCachedFilesSync(targetDir)
    if (files.length === 0) return null
    return files
  } catch (error) {
    logger.debug(`Cache read failed for ${commitSha}: ${String(error)}`)
    return null
  }
}

export function cacheFiles(source: GitSource, commitSha: string, files: FetchedFile[]): void {
  const commitDir = join(getRepoCacheDir(source), 'commits', commitSha)
  const basePath = source.path || '.'

  try {
    for (const file of files) {
      if (file.path.includes('..')) continue

      const filePath =
        basePath === '.' ? join(commitDir, file.path) : join(commitDir, basePath, file.path)
      const dir = dirname(filePath)

      mkdirSync(dir, { recursive: true })
      writeFileSync(filePath, file.content)
    }
  } catch (error) {
    logger.warn(`Failed to cache files: ${String(error)}`)
  }
}

// --- Helpers ---

function readCachedFilesSync(dirPath: string, basePath = ''): FetchedFile[] {
  const files: FetchedFile[] = []

  let entries: Dirent[]
  try {
    entries = readdirSync(dirPath, { withFileTypes: true })
  } catch {
    return []
  }

  for (const entry of entries) {
    const name = String(entry.name)
    if (name === '.git') continue

    const fullPath = join(dirPath, name)
    const relativePath = basePath ? `${basePath}/${name}` : name

    if (entry.isDirectory()) {
      files.push(...readCachedFilesSync(fullPath, relativePath))
      continue
    }

    if (!entry.isFile()) continue

    try {
      const content = readFileSync(fullPath, 'utf-8')
      const fileStat = statSync(fullPath)
      files.push({ path: relativePath, content, size: fileStat.size })
    } catch {
      // Skip unreadable files
    }
  }

  return files
}
