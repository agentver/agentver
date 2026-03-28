import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  computeIntegrity,
  extractFilesFromManifest,
  verifyIntegrity,
  IntegrityError,
} from '../installer'

describe('installer', () => {
  describe('computeIntegrity', () => {
    it('returns sha256-prefixed base64 digest', () => {
      const result = computeIntegrity([{ path: 'a.md', content: 'hello' }])
      expect(result).toMatch(/^sha256-[A-Za-z0-9+/]+=*$/)
    })

    it('matches CLI computeSha256FromFiles output', () => {
      const files = [
        { path: 'a.txt', content: 'alpha' },
        { path: 'b.txt', content: 'bravo' },
      ]

      // Replicate CLI implementation: sort by path, join with \0
      const sorted = [...files].sort((a, b) => a.path.localeCompare(b.path))
      const combined = sorted.map((f) => `${f.path}\0${f.content}`).join('\0')
      const expected = `sha256-${createHash('sha256').update(combined).digest('base64')}`

      expect(computeIntegrity(files)).toBe(expected)
    })

    it('produces the same hash regardless of input order', () => {
      const forward = [
        { path: 'a.txt', content: 'alpha' },
        { path: 'b.txt', content: 'bravo' },
      ]
      const reversed = [
        { path: 'b.txt', content: 'bravo' },
        { path: 'a.txt', content: 'alpha' },
      ]
      expect(computeIntegrity(forward)).toBe(computeIntegrity(reversed))
    })

    it('returns different hash when paths differ but content is the same', () => {
      const a = [{ path: 'a.txt', content: 'same' }]
      const b = [{ path: 'b.txt', content: 'same' }]
      expect(computeIntegrity(a)).not.toBe(computeIntegrity(b))
    })

    it('returns different hash when content differs but path is the same', () => {
      const a = [{ path: 'a.txt', content: 'one' }]
      const b = [{ path: 'a.txt', content: 'two' }]
      expect(computeIntegrity(a)).not.toBe(computeIntegrity(b))
    })

    it('is deterministic for empty input', () => {
      expect(computeIntegrity([])).toBe(computeIntegrity([]))
    })
  })

  describe('verifyIntegrity', () => {
    it('passes when computed hash matches lockfile integrity', () => {
      const files = [{ path: 'a.md', content: 'hello' }]
      const integrity = computeIntegrity(files)
      expect(() => verifyIntegrity(files, integrity, 'test/pkg')).not.toThrow()
    })

    it('throws IntegrityError when hash does not match', () => {
      const files = [{ path: 'a.md', content: 'hello' }]
      expect(() => verifyIntegrity(files, 'sha256-AAAAAA==', 'test/pkg')).toThrow(IntegrityError)
    })

    it('skips verification when lockfile integrity is undefined', () => {
      const files = [{ path: 'a.md', content: 'hello' }]
      expect(() => verifyIntegrity(files, undefined, 'test/pkg')).not.toThrow()
    })
  })

  describe('extractFilesFromManifest', () => {
    it('extracts from a flat record (key=path, value=content)', () => {
      const manifest: Record<string, unknown> = {
        'rules.md': '# Rules',
        'config.json': '{}',
      }
      const files = extractFilesFromManifest(manifest)
      expect(files).toHaveLength(2)
      expect(files).toContainEqual({ path: 'rules.md', content: '# Rules' })
      expect(files).toContainEqual({ path: 'config.json', content: '{}' })
    })

    it('extracts from an array of {path, content} objects', () => {
      const manifest = [
        { path: 'a.md', content: 'alpha' },
        { path: 'b.md', content: 'bravo' },
      ] as unknown as Record<string, unknown>
      const files = extractFilesFromManifest(manifest)
      expect(files).toHaveLength(2)
      expect(files).toContainEqual({ path: 'a.md', content: 'alpha' })
    })

    it('filters out non-string values from flat record', () => {
      const manifest: Record<string, unknown> = {
        'valid.md': 'content',
        'invalid': 42,
        'also-invalid': null,
      }
      const files = extractFilesFromManifest(manifest)
      expect(files).toHaveLength(1)
      expect(files[0]!.path).toBe('valid.md')
    })

    it('filters out malformed entries from array', () => {
      const manifest = [
        { path: 'good.md', content: 'ok' },
        { path: 123, content: 'bad path' },
        { path: 'missing-content' },
        null,
      ] as unknown as Record<string, unknown>
      const files = extractFilesFromManifest(manifest)
      expect(files).toHaveLength(1)
      expect(files[0]!.path).toBe('good.md')
    })

    it('returns empty array for empty object', () => {
      expect(extractFilesFromManifest({})).toEqual([])
    })
  })
})
