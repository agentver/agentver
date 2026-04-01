import { describe, expect, it } from 'vitest'
import { serialiseDeterministic } from '../index'

describe('serialiseDeterministic', () => {
  it('sorts object keys alphabetically', () => {
    const result = serialiseDeterministic({ zebra: 1, alpha: 2, mango: 3 })
    const parsed = JSON.parse(result)
    expect(Object.keys(parsed)).toEqual(['alpha', 'mango', 'zebra'])
  })

  it('sorts string arrays alphabetically', () => {
    const result = serialiseDeterministic({ tags: ['cherry', 'apple', 'banana'] })
    const parsed = JSON.parse(result) as { tags: string[] }
    expect(parsed.tags).toEqual(['apple', 'banana', 'cherry'])
  })

  it('preserves non-string array order', () => {
    const result = serialiseDeterministic({ items: [3, 1, 2] })
    const parsed = JSON.parse(result) as { items: number[] }
    expect(parsed.items).toEqual([3, 1, 2])
  })

  it('preserves order of mixed-type arrays', () => {
    const items = [{ name: 'b' }, { name: 'a' }]
    const result = serialiseDeterministic({ items })
    const parsed = JSON.parse(result) as { items: Array<{ name: string }> }
    expect(parsed.items).toEqual([{ name: 'b' }, { name: 'a' }])
  })

  it('uses 2-space indentation', () => {
    const result = serialiseDeterministic({ a: { b: 1 } })
    expect(result).toContain('  "a"')
    expect(result).toContain('    "b"')
  })

  it('ends with a trailing newline', () => {
    const result = serialiseDeterministic({ a: 1 })
    expect(result.endsWith('\n')).toBe(true)
  })

  it('does not end with double newline', () => {
    const result = serialiseDeterministic({ a: 1 })
    expect(result.endsWith('\n\n')).toBe(false)
  })

  it('sorts nested objects recursively', () => {
    const input = {
      outer: { z: 1, a: 2 },
      deep: { inner: { y: 'yes', b: 'bee' } },
    }
    const result = serialiseDeterministic(input)
    const parsed = JSON.parse(result) as typeof input

    expect(Object.keys(parsed)).toEqual(['deep', 'outer'])
    expect(Object.keys(parsed.outer)).toEqual(['a', 'z'])
    expect(Object.keys(parsed.deep.inner)).toEqual(['b', 'y'])
  })

  it('is idempotent — serialise(parse(serialise(x))) equals serialise(x)', () => {
    const input = { z: [3, 1, 2], a: { m: 'hello', b: 'world' }, tags: ['c', 'a', 'b'] }
    const first = serialiseDeterministic(input)
    const reparsed = JSON.parse(first) as typeof input
    const second = serialiseDeterministic(reparsed)
    expect(second).toBe(first)
  })

  it('handles null and undefined values', () => {
    const result = serialiseDeterministic({ a: null, b: undefined })
    const parsed = JSON.parse(result)
    expect(parsed).toEqual({ a: null })
  })

  it('handles empty objects and arrays', () => {
    const result = serialiseDeterministic({ items: [], meta: {} })
    const parsed = JSON.parse(result) as { items: unknown[]; meta: Record<string, unknown> }
    expect(parsed.items).toEqual([])
    expect(parsed.meta).toEqual({})
  })
})
