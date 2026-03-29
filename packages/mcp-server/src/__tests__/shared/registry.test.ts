import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getCredentials, getRegistryUrl, isAuthenticated } from '../../shared/registry'

describe('registry', () => {
  const originalEnv = process.env

  beforeEach(() => {
    process.env = { ...originalEnv }
  })

  afterEach(() => {
    process.env = originalEnv
    vi.restoreAllMocks()
  })

  // ---------------------------------------------------------------------------
  // getRegistryUrl
  // ---------------------------------------------------------------------------

  describe('getRegistryUrl', () => {
    it('returns the default registry URL when AGENTVER_REGISTRY is not set', () => {
      delete process.env.AGENTVER_REGISTRY
      expect(getRegistryUrl()).toBe('https://app.agentver.com/api/v1')
    })

    it('returns the custom URL when AGENTVER_REGISTRY is set', () => {
      process.env.AGENTVER_REGISTRY = 'https://custom.registry.com/api'
      expect(getRegistryUrl()).toBe('https://custom.registry.com/api')
    })
  })

  // ---------------------------------------------------------------------------
  // getCredentials
  // ---------------------------------------------------------------------------

  describe('getCredentials', () => {
    it('returns null or a valid credentials object', () => {
      const result = getCredentials()
      expect(result === null || typeof result === 'object').toBe(true)
    })
  })

  // ---------------------------------------------------------------------------
  // isAuthenticated
  // ---------------------------------------------------------------------------

  describe('isAuthenticated', () => {
    it('returns a boolean', () => {
      const result = isAuthenticated()
      expect(typeof result).toBe('boolean')
    })
  })
})
