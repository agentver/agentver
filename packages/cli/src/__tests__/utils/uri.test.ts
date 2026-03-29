import { describe, expect, it } from 'vitest'
import { extractOrgFromUri, parseUriSegments } from '../../utils/uri'

describe('parseUriSegments', () => {
  it('parses agentver://myorg into host/owner/repo', () => {
    expect(parseUriSegments('agentver://myorg')).toEqual({
      host: 'agentver',
      owner: 'myorg',
      repo: 'platform',
    })
  })

  it('parses agentver://org/skills/name taking only the org', () => {
    expect(parseUriSegments('agentver://org/skills/name')).toEqual({
      host: 'agentver',
      owner: 'org',
      repo: 'platform',
    })
  })

  it('returns null for agentver:// with no org', () => {
    expect(parseUriSegments('agentver://')).toBeNull()
  })

  it('returns null for agentver:/// (triple slash, empty org)', () => {
    expect(parseUriSegments('agentver:///')).toBeNull()
  })

  it('parses http:// prefixed URIs', () => {
    expect(parseUriSegments('http://gitlab.com/team/repo')).toEqual({
      host: 'gitlab.com',
      owner: 'team',
      repo: 'repo',
    })
  })

  it('parses github.com/test-org/test-repo', () => {
    expect(parseUriSegments('github.com/test-org/test-repo')).toEqual({
      host: 'github.com',
      owner: 'test-org',
      repo: 'test-repo',
    })
  })

  it('parses https://github.com/test-org/test-repo', () => {
    expect(parseUriSegments('https://github.com/test-org/test-repo')).toEqual({
      host: 'github.com',
      owner: 'test-org',
      repo: 'test-repo',
    })
  })

  it('returns null for empty string', () => {
    expect(parseUriSegments('')).toBeNull()
  })

  it('returns null for a single segment', () => {
    expect(parseUriSegments('github.com')).toBeNull()
  })

  it('sets repo to unknown when only host/owner present', () => {
    expect(parseUriSegments('github.com/myorg')).toEqual({
      host: 'github.com',
      owner: 'myorg',
      repo: 'unknown',
    })
  })
})

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

  it('returns null for agentver:// with whitespace-only org', () => {
    expect(extractOrgFromUri('agentver:// ')).toBeNull()
  })
})
