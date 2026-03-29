import { describe, expect, it } from 'vitest'
import { SEMVER_REGEX } from '../constants'

describe('SEMVER_REGEX', () => {
  describe('valid versions', () => {
    it.each([
      '0.0.0',
      '1.0.0',
      '0.1.0',
      '0.0.1',
      '12.34.56',
      '999.999.999',
    ])('accepts basic version "%s"', (v) => {
      expect(SEMVER_REGEX.test(v)).toBe(true)
    })

    it.each([
      '1.0.0-alpha',
      '1.0.0-alpha.1',
      '1.0.0-0.3.7',
      '1.0.0-x.7.z.92',
      '1.0.0-beta.1',
      '1.0.0-rc1',
      '1.0.0-alpha-beta',
      '1.0.0-1',
      '1.0.0-0',
    ])('accepts pre-release version "%s"', (v) => {
      expect(SEMVER_REGEX.test(v)).toBe(true)
    })

    it.each([
      '1.0.0+build',
      '1.0.0+build.123',
      '1.0.0+20130313144700',
      '1.0.0+exp.sha.5114f85',
      '1.0.0+21AF26D3',
    ])('accepts build metadata version "%s"', (v) => {
      expect(SEMVER_REGEX.test(v)).toBe(true)
    })

    it.each([
      '1.0.0-beta.1+build.123',
      '1.0.0-alpha+001',
      '1.0.0-rc.1+sha.abc123',
    ])('accepts pre-release + build metadata "%s"', (v) => {
      expect(SEMVER_REGEX.test(v)).toBe(true)
    })
  })

  describe('invalid versions', () => {
    it.each(['01.0.0', '0.01.0', '0.0.01', '001.002.003'])('rejects leading zeros "%s"', (v) => {
      expect(SEMVER_REGEX.test(v)).toBe(false)
    })

    it.each(['1.0', '1', '1.0.0.0', ''])('rejects incomplete or extra segments "%s"', (v) => {
      expect(SEMVER_REGEX.test(v)).toBe(false)
    })

    it.each([
      'v1.0.0',
      'abc',
      'a.b.c',
      '1.0.0-',
      '1.0.0+',
      '1.0.0-beta..1',
      '1.0.0+build..1',
    ])('rejects malformed version "%s"', (v) => {
      expect(SEMVER_REGEX.test(v)).toBe(false)
    })

    it.each([
      '1.0.0-01',
      '1.0.0-0123',
    ])('rejects leading zeros in numeric pre-release identifiers "%s"', (v) => {
      expect(SEMVER_REGEX.test(v)).toBe(false)
    })
  })
})
