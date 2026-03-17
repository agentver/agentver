import { describe, expect, it } from 'vitest'
import { serialiseDeterministic } from '../../storage/serialise'

describe('serialiseDeterministic', () => {
  it('sorts object keys alphabetically', () => {
    const input = { z: 1, a: 2, m: 3 }
    const result = serialiseDeterministic(input)
    const parsed = JSON.parse(result)
    const keys = Object.keys(parsed)
    expect(keys).toEqual(['a', 'm', 'z'])
  })

  it('sorts nested object keys', () => {
    const input = { outer: { z: 1, a: 2 } }
    const result = serialiseDeterministic(input)
    const parsed = JSON.parse(result)
    expect(Object.keys(parsed.outer)).toEqual(['a', 'z'])
  })

  it('sorts arrays of strings alphabetically', () => {
    const input = { agents: ['cursor', 'aider', 'claude'] }
    const result = serialiseDeterministic(input)
    const parsed = JSON.parse(result)
    expect(parsed.agents).toEqual(['aider', 'claude', 'cursor'])
  })

  it('preserves order of non-string arrays', () => {
    const input = { numbers: [3, 1, 2] }
    const result = serialiseDeterministic(input)
    const parsed = JSON.parse(result)
    expect(parsed.numbers).toEqual([3, 1, 2])
  })

  it('preserves order of mixed arrays', () => {
    const input = { mixed: ['b', 1, 'a'] }
    const result = serialiseDeterministic(input)
    const parsed = JSON.parse(result)
    expect(parsed.mixed).toEqual(['b', 1, 'a'])
  })

  it('uses 2-space indentation', () => {
    const input = { key: 'value' }
    const result = serialiseDeterministic(input)
    expect(result).toContain('  "key"')
  })

  it('ends with a trailing newline', () => {
    const result = serialiseDeterministic({ a: 1 })
    expect(result.endsWith('\n')).toBe(true)
  })

  it('handles null values', () => {
    const input = { key: null }
    const result = serialiseDeterministic(input)
    const parsed = JSON.parse(result)
    expect(parsed.key).toBeNull()
  })

  it('handles empty objects', () => {
    const result = serialiseDeterministic({})
    expect(result).toBe('{}\n')
  })

  it('handles deeply nested structures', () => {
    const input = {
      z: { b: { d: 1, c: 2 }, a: 3 },
      a: { y: 4, x: 5 },
    }
    const result = serialiseDeterministic(input)
    const parsed = JSON.parse(result)
    expect(Object.keys(parsed)).toEqual(['a', 'z'])
    expect(Object.keys(parsed.a)).toEqual(['x', 'y'])
    expect(Object.keys(parsed.z)).toEqual(['a', 'b'])
    expect(Object.keys(parsed.z.b)).toEqual(['c', 'd'])
  })

  it('produces identical output for identical data regardless of key order', () => {
    const input1 = { b: 2, a: 1 }
    const input2 = { a: 1, b: 2 }
    expect(serialiseDeterministic(input1)).toBe(serialiseDeterministic(input2))
  })

  it('handles arrays of objects', () => {
    const input = {
      items: [
        { z: 1, a: 2 },
        { y: 3, b: 4 },
      ],
    }
    const result = serialiseDeterministic(input)
    const parsed = JSON.parse(result)
    expect(Object.keys(parsed.items[0])).toEqual(['a', 'z'])
    expect(Object.keys(parsed.items[1])).toEqual(['b', 'y'])
  })

  it('output is valid JSON that can be parsed back without loss', () => {
    const input = {
      name: 'test-skill',
      version: 2,
      nested: { enabled: true, tags: ['a', 'b'] },
      nullable: null,
    }
    const serialised = serialiseDeterministic(input)
    const parsed = JSON.parse(serialised)
    expect(parsed).toEqual(input)
  })

  it('handles boolean and numeric values without coercion', () => {
    const input = { flag: false, count: 0, empty: '' }
    const result = serialiseDeterministic(input)
    const parsed = JSON.parse(result)
    expect(parsed.flag).toBe(false)
    expect(parsed.count).toBe(0)
    expect(parsed.empty).toBe('')
  })
})
