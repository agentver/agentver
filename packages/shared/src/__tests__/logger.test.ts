import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createLogger } from '../logger'

describe('createLogger', () => {
  let originalNodeEnv: string | undefined

  beforeEach(() => {
    originalNodeEnv = process.env.NODE_ENV
  })

  afterEach(() => {
    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV
    } else {
      process.env.NODE_ENV = originalNodeEnv
    }
  })

  it('should create a logger with the specified name', () => {
    const logger = createLogger('test-logger')
    expect(logger.settings.name).toBe('test-logger')
  })

  it('should use development minLevel when NODE_ENV is not production', () => {
    process.env.NODE_ENV = 'development'
    const logger = createLogger('dev-logger')
    expect(logger.settings.minLevel).toBe(0)
  })

  it('should use production minLevel (3) when NODE_ENV is production', () => {
    process.env.NODE_ENV = 'production'
    const logger = createLogger('prod-logger')
    expect(logger.settings.minLevel).toBe(3)
  })

  it('should accept custom minLevel override', () => {
    const logger = createLogger('custom-logger', 5)
    expect(logger.settings.minLevel).toBe(5)
  })
})
