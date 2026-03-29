import { describe, expect, it } from 'vitest'
import { extractOrgFromUri } from '../../utils/uri'

describe('extractOrgFromUri', () => {
  // agentver:// protocol URIs
  it('extracts org from agentver://myorg', () => {
    expect(extractOrgFromUri('agentver://myorg')).toBe('myorg')
  })

  it('extracts org from agentver://lleverage', () => {
    expect(extractOrgFromUri('agentver://lleverage')).toBe('lleverage')
  })

  it('extracts org from agentver://org/skills/name', () => {
    expect(extractOrgFromUri('agentver://org/skills/name')).toBe('org')
  })

  it('returns null for agentver:// with no org', () => {
    expect(extractOrgFromUri('agentver://')).toBeNull()
  })

  // Standard host/org/repo URIs
  it('extracts org from github.com/test-org/test-repo', () => {
    expect(extractOrgFromUri('github.com/test-org/test-repo')).toBe('test-org')
  })

  it('extracts org from gitlab.com/owner/repo', () => {
    expect(extractOrgFromUri('gitlab.com/owner/repo')).toBe('owner')
  })

  // https:// prefixed URIs
  it('extracts org from https://github.com/test-org/test-repo', () => {
    expect(extractOrgFromUri('https://github.com/test-org/test-repo')).toBe('test-org')
  })

  // Edge cases
  it('returns null for empty string', () => {
    expect(extractOrgFromUri('')).toBeNull()
  })

  it('returns null for a single segment (host only)', () => {
    expect(extractOrgFromUri('github.com')).toBeNull()
  })
})
