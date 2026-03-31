import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ensureStorageDir, getStorageRoot, writeJsonFileAtomic } from '../index'

let tmpDir: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(homedir(), '.agentver-test-files-'))
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

describe('getStorageRoot', () => {
  it('returns .agentver/ under the project root for project scope', () => {
    const root = getStorageRoot('/some/project', 'project')
    expect(root).toBe('/some/project/.agentver')
  })

  it('returns .agentver/ under the home directory for global scope', () => {
    const root = getStorageRoot('/some/project', 'global')
    expect(root).toBe(join(homedir(), '.agentver'))
  })
})

describe('writeJsonFileAtomic', () => {
  it('writes a file that exists after the call', () => {
    const filePath = join(tmpDir, 'test.json')
    writeJsonFileAtomic(filePath, { hello: 'world' })
    expect(existsSync(filePath)).toBe(true)
  })

  it('produces valid JSON content', () => {
    const filePath = join(tmpDir, 'test.json')
    const data = { foo: 'bar', num: 42 }
    writeJsonFileAtomic(filePath, data)
    const content = readFileSync(filePath, 'utf-8')
    expect(JSON.parse(content)).toEqual({ foo: 'bar', num: 42 })
  })

  it('uses deterministic serialisation (sorted keys)', () => {
    const filePath = join(tmpDir, 'sorted.json')
    writeJsonFileAtomic(filePath, { z: 1, a: 2, m: 3 })
    const content = readFileSync(filePath, 'utf-8')
    const keys = Object.keys(JSON.parse(content))
    expect(keys).toEqual(['a', 'm', 'z'])
  })

  it('does not leave a .tmp file behind', () => {
    const filePath = join(tmpDir, 'clean.json')
    writeJsonFileAtomic(filePath, { clean: true })
    expect(existsSync(`${filePath}.tmp`)).toBe(false)
  })

  it('overwrites an existing file', () => {
    const filePath = join(tmpDir, 'overwrite.json')
    writeJsonFileAtomic(filePath, { version: 1 })
    writeJsonFileAtomic(filePath, { version: 2 })
    const content = JSON.parse(readFileSync(filePath, 'utf-8')) as { version: number }
    expect(content.version).toBe(2)
  })
})

describe('ensureStorageDir', () => {
  it('creates .agentver directory if missing', () => {
    const agentverDir = join(tmpDir, '.agentver')
    expect(existsSync(agentverDir)).toBe(false)
    ensureStorageDir(tmpDir, 'project')
    expect(existsSync(agentverDir)).toBe(true)
  })

  it('is a no-op if directory already exists', () => {
    ensureStorageDir(tmpDir, 'project')
    // Calling again should not throw
    expect(() => ensureStorageDir(tmpDir, 'project')).not.toThrow()
  })
})
