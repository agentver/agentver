import { describe, expect, it } from 'vitest'
import { AGENT_IDS, resolveAgentId } from '../types'

describe('AGENT_IDS', () => {
  it('should contain exactly 43 agent IDs', () => {
    expect(AGENT_IDS).toHaveLength(43)
  })

  it('should not contain duplicates', () => {
    const unique = new Set(AGENT_IDS)
    expect(unique.size).toBe(AGENT_IDS.length)
  })

  it('should include all expected core agents', () => {
    const expected = [
      'claude-code',
      'cursor',
      'codex',
      'copilot',
      'windsurf',
      'gemini-cli',
      'roo',
      'goose',
      'aider',
    ]
    for (const id of expected) {
      expect(AGENT_IDS).toContain(id)
    }
  })

  it('should be sorted alphabetically', () => {
    const sorted = [...AGENT_IDS].sort()
    expect([...AGENT_IDS]).toEqual(sorted)
  })
})

describe('resolveAgentId', () => {
  it('should resolve all 43 primary IDs', () => {
    for (const id of AGENT_IDS) {
      expect(resolveAgentId(id)).toBe(id)
    }
  })

  it('should resolve known aliases to their canonical IDs', () => {
    expect(resolveAgentId('gemini')).toBe('gemini-cli')
    expect(resolveAgentId('roo-code')).toBe('roo')
    expect(resolveAgentId('github-copilot')).toBe('copilot')
  })

  it('should be case-insensitive', () => {
    expect(resolveAgentId('Claude-Code')).toBe('claude-code')
    expect(resolveAgentId('CURSOR')).toBe('cursor')
    expect(resolveAgentId('GEMINI')).toBe('gemini-cli')
  })

  it('should trim whitespace', () => {
    expect(resolveAgentId('  claude-code  ')).toBe('claude-code')
    expect(resolveAgentId(' gemini ')).toBe('gemini-cli')
  })

  it('should return null for unknown IDs', () => {
    expect(resolveAgentId('nonexistent-agent')).toBeNull()
    expect(resolveAgentId('vim')).toBeNull()
  })

  it('should return null for empty string', () => {
    expect(resolveAgentId('')).toBeNull()
  })
})
