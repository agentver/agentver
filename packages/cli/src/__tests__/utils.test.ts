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
  it('re-exports SEMVER_REGEX from @agentver/shared', () => {
    expect(SEMVER_REGEX).toBeInstanceOf(RegExp)
    expect(SEMVER_REGEX.test('1.0.0')).toBe(true)
  })
})
