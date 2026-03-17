import { describe, expect, it } from 'vitest'

import { generateId, generateShortId } from '../id'

describe('generateId', () => {
  it('should return a 21-character string by default', () => {
    const id = generateId()
    expect(id).toHaveLength(21)
    expect(typeof id).toBe('string')
  })

  it('should return a string of specified length', () => {
    const id8 = generateId(8)
    expect(id8).toHaveLength(8)

    const id32 = generateId(32)
    expect(id32).toHaveLength(32)
  })

  it('should generate unique IDs on consecutive calls', () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateId()))
    expect(ids.size).toBe(100)
  })
})

describe('generateShortId', () => {
  it('should return a 12-character string', () => {
    const id = generateShortId()
    expect(id).toHaveLength(12)
    expect(typeof id).toBe('string')
  })

  it('should generate unique IDs on consecutive calls', () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateShortId()))
    expect(ids.size).toBe(100)
  })
})
