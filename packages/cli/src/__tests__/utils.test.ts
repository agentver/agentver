import { AgentverError } from '@agentver/shared'
import { describe, expect, it } from 'vitest'
import { extractError, SEMVER_REGEX } from '../utils'

describe('extractError', () => {
  it('preserves AgentverError code and message', () => {
    const error = new AgentverError('VALIDATION_ERROR', 'Invalid input')
    const result = extractError(error, 'FALLBACK')

    expect(result).toEqual({ code: 'VALIDATION_ERROR', message: 'Invalid input' })
  })

  it('uses fallback code for plain Error', () => {
    const error = new Error('Something broke')
    const result = extractError(error, 'INSTALL_FAILED')

    expect(result).toEqual({ code: 'INSTALL_FAILED', message: 'Something broke' })
  })

  it('uses fallback code and stringifies non-Error values', () => {
    expect(extractError('string error', 'CODE')).toEqual({
      code: 'CODE',
      message: 'string error',
    })

    expect(extractError(42, 'CODE')).toEqual({
      code: 'CODE',
      message: '42',
    })

    expect(extractError(null, 'CODE')).toEqual({
      code: 'CODE',
      message: 'null',
    })
  })
})

describe('SEMVER_REGEX', () => {
  it('matches valid semver versions', () => {
    expect(SEMVER_REGEX.test('1.0.0')).toBe(true)
    expect(SEMVER_REGEX.test('0.1.0')).toBe(true)
    expect(SEMVER_REGEX.test('12.34.56')).toBe(true)
    expect(SEMVER_REGEX.test('1.0.0-beta.1')).toBe(true)
    expect(SEMVER_REGEX.test('1.0.0-rc1')).toBe(true)
  })

  it('rejects invalid versions', () => {
    expect(SEMVER_REGEX.test('1.0')).toBe(false)
    expect(SEMVER_REGEX.test('v1.0.0')).toBe(false)
    expect(SEMVER_REGEX.test('abc')).toBe(false)
    expect(SEMVER_REGEX.test('')).toBe(false)
  })
})
