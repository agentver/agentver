import { describe, expect, it } from 'vitest'
import type { FetchedFile } from '../../git/types'
import { checkFilePolicy, isBinaryContent } from '../../security/file-policy'

describe('isBinaryContent', () => {
  it('returns false for normal text content', () => {
    expect(isBinaryContent('Hello, world!')).toBe(false)
  })

  it('returns true for content containing null bytes', () => {
    expect(isBinaryContent('Hello\x00World')).toBe(true)
  })

  it('returns false for empty content', () => {
    expect(isBinaryContent('')).toBe(false)
  })

  it('only scans the first 8KB', () => {
    // Null byte after 8192 characters should not be detected
    const content = `${'A'.repeat(8193)}\x00`
    expect(isBinaryContent(content)).toBe(false)
  })

  it('detects null byte within first 8KB', () => {
    const content = `${'A'.repeat(100)}\x00${'B'.repeat(100)}`
    expect(isBinaryContent(content)).toBe(true)
  })
})

describe('checkFilePolicy', () => {
  it('returns no findings for clean text files', () => {
    const files: FetchedFile[] = [
      { path: 'index.md', content: '# Hello', size: 7 },
      { path: 'config.json', content: '{}', size: 2 },
    ]
    const findings = checkFilePolicy(files)
    expect(findings).toHaveLength(0)
  })

  it('flags binary files', () => {
    const files: FetchedFile[] = [{ path: 'data.bin', content: 'Hello\x00World', size: 11 }]
    const findings = checkFilePolicy(files)
    expect(findings).toHaveLength(1)
    expect(findings[0]!.category).toBe('BINARY_FILE')
    expect(findings[0]!.severity).toBe('HIGH')
  })

  it('flags executable extensions', () => {
    const extensionTests = ['.exe', '.sh', '.bat', '.cmd', '.ps1', '.dll', '.so', '.dylib']
    for (const ext of extensionTests) {
      const files: FetchedFile[] = [{ path: `script${ext}`, content: 'safe content', size: 12 }]
      const findings = checkFilePolicy(files)
      const execFindings = findings.filter((f) => f.category === 'DISALLOWED_FILE_TYPE')
      expect(execFindings.length).toBeGreaterThanOrEqual(1)
    }
  })

  it('flags dangerous dotfiles', () => {
    const dotfiles = ['.env', '.bashrc', '.zshrc', '.profile', '.gitconfig']
    for (const dotfile of dotfiles) {
      const files: FetchedFile[] = [{ path: dotfile, content: 'SECRET=123', size: 10 }]
      const findings = checkFilePolicy(files)
      const dotfileFindings = findings.filter(
        (f) => f.category === 'DISALLOWED_FILE_TYPE' && f.severity === 'CRITICAL'
      )
      expect(dotfileFindings.length).toBeGreaterThanOrEqual(1)
    }
  })

  it('flags files exceeding 1MB', () => {
    const files: FetchedFile[] = [{ path: 'big-file.txt', content: 'x', size: 2 * 1024 * 1024 }]
    const findings = checkFilePolicy(files)
    const sizeFindings = findings.filter((f) => f.category === 'EXCESSIVE_SIZE')
    expect(sizeFindings.length).toBeGreaterThanOrEqual(1)
    expect(sizeFindings[0]!.severity).toBe('LOW')
  })

  it('flags total package size exceeding 10MB', () => {
    const files: FetchedFile[] = Array.from({ length: 11 }, (_, i) => ({
      path: `file-${i}.txt`,
      content: 'x',
      size: 1024 * 1024, // 1MB each = 11MB total
    }))
    const findings = checkFilePolicy(files)
    const totalSizeFindings = findings.filter(
      (f) => f.category === 'EXCESSIVE_SIZE' && f.file === '(package total)'
    )
    expect(totalSizeFindings).toHaveLength(1)
    expect(totalSizeFindings[0]!.severity).toBe('MEDIUM')
  })

  it('reports multiple findings per file', () => {
    const files: FetchedFile[] = [
      { path: '.env', content: 'data\x00binary', size: 2 * 1024 * 1024 },
    ]
    const findings = checkFilePolicy(files)
    // Should flag: binary content, dangerous dotfile, excessive size
    expect(findings.length).toBeGreaterThanOrEqual(3)
  })
})
