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
  })
})
