import { describe, expect, it } from 'vitest'
import {
  computeIntegrity,
  computeIntegrityFromBuffer,
  IntegrityError,
  verifyIntegrity,
} from '../index'

describe('computeIntegrity', () => {
  it('returns a sha256-prefixed string', () => {
    const hash = computeIntegrity([{ path: 'SKILL.md', content: '# Hello' }])
    expect(hash).toMatch(/^sha256-/)
  })

  it('is deterministic — same files produce the same hash', () => {
    const files = [
      { path: 'SKILL.md', content: '# Skill' },
      { path: 'lib.ts', content: 'export const x = 1' },
    ]
    const hash1 = computeIntegrity(files)
    const hash2 = computeIntegrity(files)
    expect(hash1).toBe(hash2)
  })

  it('is order-independent — files are sorted by path before hashing', () => {
    const filesAsc = [
      { path: 'a.md', content: 'alpha' },
      { path: 'b.md', content: 'bravo' },
    ]
    const filesDesc = [
      { path: 'b.md', content: 'bravo' },
      { path: 'a.md', content: 'alpha' },
    ]
    expect(computeIntegrity(filesAsc)).toBe(computeIntegrity(filesDesc))
  })

  it('produces different hashes for different content', () => {
    const hash1 = computeIntegrity([{ path: 'a.md', content: 'hello' }])
    const hash2 = computeIntegrity([{ path: 'a.md', content: 'world' }])
    expect(hash1).not.toBe(hash2)
  })

  it('produces different hashes for different paths with same content', () => {
    const hash1 = computeIntegrity([{ path: 'a.md', content: 'same' }])
    const hash2 = computeIntegrity([{ path: 'b.md', content: 'same' }])
    expect(hash1).not.toBe(hash2)
  })

  it('handles empty file list', () => {
    const hash = computeIntegrity([])
    expect(hash).toMatch(/^sha256-/)
  })
})

describe('computeIntegrityFromBuffer', () => {
  it('returns a sha256-prefixed string from a string', () => {
    const hash = computeIntegrityFromBuffer('test content')
    expect(hash).toMatch(/^sha256-/)
  })

  it('returns a sha256-prefixed string from a Buffer', () => {
    const hash = computeIntegrityFromBuffer(Buffer.from('test content'))
    expect(hash).toMatch(/^sha256-/)
  })

  it('produces the same hash for equivalent string and Buffer', () => {
    const content = 'hello world'
    const fromString = computeIntegrityFromBuffer(content)
    const fromBuffer = computeIntegrityFromBuffer(Buffer.from(content))
    expect(fromString).toBe(fromBuffer)
  })
})

describe('verifyIntegrity', () => {
  const files = [{ path: 'SKILL.md', content: '# Test Skill' }]

  it('passes when hashes match', () => {
    const expected = computeIntegrity(files)
    expect(() => verifyIntegrity(files, expected, 'test-skill')).not.toThrow()
  })

  it('is a no-op when expected is an empty string', () => {
    expect(() => verifyIntegrity(files, '', 'test-skill')).not.toThrow()
  })

  it('throws IntegrityError when hashes differ', () => {
    expect(() => verifyIntegrity(files, 'sha256-wrong', 'test-skill')).toThrow(IntegrityError)
  })

  it('includes package name in the error message', () => {
    try {
      verifyIntegrity(files, 'sha256-wrong', 'my-package')
      expect.fail('Expected IntegrityError to be thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(IntegrityError)
      const integrityError = error as IntegrityError
      expect(integrityError.packageName).toBe('my-package')
      expect(integrityError.expected).toBe('sha256-wrong')
      expect(integrityError.actual).toMatch(/^sha256-/)
      expect(integrityError.message).toContain('my-package')
    }
  })
})
