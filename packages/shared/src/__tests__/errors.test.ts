import { describe, expect, it } from 'vitest'
import type { AgentverErrorCode } from '../errors'
import { AgentverError } from '../errors'

describe('AgentverError', () => {
  it('should be an instance of Error', () => {
    const error = new AgentverError('NOT_FOUND', 'Resource not found')
    expect(error).toBeInstanceOf(Error)
  })

  it('should set name to AgentverError', () => {
    const error = new AgentverError('INTERNAL_ERROR', 'Something went wrong')
    expect(error.name).toBe('AgentverError')
  })

  it('should store the error code', () => {
    const error = new AgentverError('UNAUTHORISED', 'Not authenticated')
    expect(error.code).toBe('UNAUTHORISED')
  })

  it('should store the message', () => {
    const error = new AgentverError('FORBIDDEN', 'Access denied')
    expect(error.message).toBe('Access denied')
  })

  it('should work with all 9 error codes', () => {
    const codes: AgentverErrorCode[] = [
      'NOT_FOUND',
      'UNAUTHORISED',
      'FORBIDDEN',
      'CONFLICT',
      'VALIDATION_ERROR',
      'INTERNAL_ERROR',
      'RATE_LIMITED',
      'STORAGE_ERROR',
      'INTEGRITY_ERROR',
    ]

    for (const code of codes) {
      const error = new AgentverError(code, `Test message for ${code}`)
      expect(error.code).toBe(code)
      expect(error.message).toBe(`Test message for ${code}`)
      expect(error.name).toBe('AgentverError')
      expect(error).toBeInstanceOf(Error)
    }
  })
})
