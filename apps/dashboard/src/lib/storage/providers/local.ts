import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import type { StorageProvider } from '../types'

export class LocalStorageProvider implements StorageProvider {
  private readonly basePath: string

  constructor(basePath?: string) {
    this.basePath = basePath ?? process.env.STORAGE_PATH ?? './.data/storage'
  }

  private resolvePath(key: string): string {
    const resolved = join(this.basePath, key)
    // Prevent path traversal
    const rel = relative(this.basePath, resolved)
    if (rel.startsWith('..') || rel.startsWith('/')) {
      throw new Error(`Invalid storage key: ${key}`)
    }
    return resolved
  }

  async put(key: string, data: Buffer | Uint8Array): Promise<void> {
    const filePath = this.resolvePath(key)
    await mkdir(dirname(filePath), { recursive: true })
    await writeFile(filePath, data)
  }

  async get(key: string): Promise<Buffer | null> {
    const filePath = this.resolvePath(key)
    try {
      return await readFile(filePath)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null
      }
      throw error
    }
  }

  async delete(key: string): Promise<void> {
    const filePath = this.resolvePath(key)
    try {
      await rm(filePath)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error
      }
    }
  }

  async exists(key: string): Promise<boolean> {
    const filePath = this.resolvePath(key)
    try {
      await stat(filePath)
      return true
    } catch {
      return false
    }
  }

  async list(prefix: string): Promise<string[]> {
    const dirPath = this.resolvePath(prefix)
    try {
      const entries = await readdir(dirPath, { recursive: true })
      return entries
        .filter((entry): entry is string => typeof entry === 'string')
        .map((entry) => join(prefix, entry))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return []
      }
      throw error
    }
  }
}
