import { describe, expect, it } from 'vitest'
import type { AgentverErrorCode } from '../errors'
import { AgentverError } from '../errors'

describe('AgentverError', () => {
  it('should set name, code, message, and extend Error for all error codes', () => {
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
