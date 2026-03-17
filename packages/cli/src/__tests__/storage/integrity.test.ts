import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('storage/integrity', () => {
  let integrityModule: typeof import('../../storage/integrity')

  beforeEach(async () => {
    vi.clearAllMocks()
    integrityModule = await import('../../storage/integrity')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('computeSha256FromBuffer', () => {
    it('computes hash from a string', () => {
      const result = integrityModule.computeSha256FromBuffer('test data')
      expect(result).toMatch(/^sha256-/)
    })

    it('computes hash from a Buffer', () => {
      const result = integrityModule.computeSha256FromBuffer(Buffer.from('test data'))
      expect(result).toMatch(/^sha256-/)
    })

    it('returns same hash for same content regardless of type', () => {
      const fromString = integrityModule.computeSha256FromBuffer('same content')
      const fromBuffer = integrityModule.computeSha256FromBuffer(Buffer.from('same content'))
      expect(fromString).toBe(fromBuffer)
    })
  })

  describe('computeSha256FromFiles', () => {
    it('computes hash from concatenated file contents', () => {
      const files = [
        { path: 'a.txt', content: 'hello ' },
        { path: 'b.txt', content: 'world' },
      ]
      const result = integrityModule.computeSha256FromFiles(files)
      expect(result).toMatch(/^sha256-/)
    })

    it('returns different hash for different file contents', () => {
      const files1 = [{ path: 'a.txt', content: 'hello' }]
      const files2 = [{ path: 'a.txt', content: 'world' }]
      expect(integrityModule.computeSha256FromFiles(files1)).not.toBe(
        integrityModule.computeSha256FromFiles(files2)
      )
    })

    it('produces the same hash regardless of input order (files are sorted by path)', () => {
      const filesAFirst = [
        { path: 'a.txt', content: 'alpha' },
        { path: 'b.txt', content: 'bravo' },
      ]
      const filesBFirst = [
        { path: 'b.txt', content: 'bravo' },
        { path: 'a.txt', content: 'alpha' },
      ]
      expect(integrityModule.computeSha256FromFiles(filesAFirst)).toBe(
        integrityModule.computeSha256FromFiles(filesBFirst)
      )
    })

    it('returns different hash when file paths differ but contents are the same', () => {
      const files1 = [{ path: 'a.txt', content: 'same' }]
      const files2 = [{ path: 'b.txt', content: 'same' }]
      expect(integrityModule.computeSha256FromFiles(files1)).not.toBe(
        integrityModule.computeSha256FromFiles(files2)
      )
    })

    it('returns empty-input hash for an empty files array', () => {
      const result = integrityModule.computeSha256FromFiles([])
      expect(result).toMatch(/^sha256-/)
      // Should be deterministic
      expect(result).toBe(integrityModule.computeSha256FromFiles([]))
    })
  })
})
