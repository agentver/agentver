import { describe, expect, it } from 'vitest'
import { getConfigFilePath, translateConfig } from '../config-translator'
import type { AgentId } from '../types'

describe('translateConfig', () => {
  const sampleContent = '# My Skill\n\nDo the thing.'
  const sampleName = 'my-skill'

  it('should passthrough markdown for claude-code', () => {
    const [result] = translateConfig(sampleContent, sampleName, ['claude-code'])
    expect(result!.agentId).toBe('claude-code')
    expect(result!.filePath).toBe('CLAUDE.md')
    expect(result!.content).toBe(sampleContent)
  })

  it('should passthrough markdown for cursor (as .cursorrules)', () => {
    const [result] = translateConfig(sampleContent, sampleName, ['cursor'])
    expect(result!.filePath).toBe('.cursorrules')
    expect(result!.content).toBe(sampleContent)
  })

  it('should passthrough markdown for copilot (as .github/copilot-instructions.md)', () => {
    const [result] = translateConfig(sampleContent, sampleName, ['copilot'])
    expect(result!.filePath).toBe('.github/copilot-instructions.md')
    expect(result!.content).toBe(sampleContent)
  })

  it('should passthrough markdown for windsurf (as .windsurfrules)', () => {
    const [result] = translateConfig(sampleContent, sampleName, ['windsurf'])
    expect(result!.filePath).toBe('.windsurfrules')
    expect(result!.content).toBe(sampleContent)
  })

  it('should generate YAML for goose (with escaped quotes)', () => {
    const content = 'Use "strict" mode and backslash \\ escaping'
    const [result] = translateConfig(content, sampleName, ['goose'])
    expect(result!.filePath).toBe('.goose/config.yaml')
    expect(result!.content).toContain('instructions:')
    expect(result!.content).toContain('\\"strict\\"')
    expect(result!.content).toContain('\\\\')
  })

  it('should generate static aider config (read: - AGENTS.md)', () => {
    const [result] = translateConfig(sampleContent, sampleName, ['aider'])
    expect(result!.filePath).toBe('.aider.conf.yml')
    expect(result!.content).toBe('read:\n  - AGENTS.md\n')
  })

  it('should use dynamic path for roo (.roo/rules/{name}.md)', () => {
    const [result] = translateConfig(sampleContent, 'coding-standards', ['roo'])
    expect(result!.filePath).toBe('.roo/rules/coding-standards.md')
    expect(result!.content).toBe(sampleContent)
  })

  it('should use dynamic path for cline (.clinerules/{name}.md)', () => {
    const [result] = translateConfig(sampleContent, 'lint-rules', ['cline'])
    expect(result!.filePath).toBe('.clinerules/lint-rules.md')
    expect(result!.content).toBe(sampleContent)
  })

  it('should translate to multiple agents in one call', () => {
    const results = translateConfig(sampleContent, sampleName, [
      'claude-code',
      'cursor',
      'windsurf',
    ])
    expect(results).toHaveLength(3)
    const agentIds = results.map((r) => r.agentId)
    expect(agentIds).toEqual(['claude-code', 'cursor', 'windsurf'])
  })

  it('should use default fallback for unlisted agents', () => {
    // augment has no explicit translator, should fall back to config dir path
    const [result] = translateConfig(sampleContent, sampleName, ['augment'])
    expect(result!.agentId).toBe('augment')
    expect(result!.filePath).toBe('.augment/AGENTS.md')
    expect(result!.content).toBe(sampleContent)
  })

  it('should use AGENTS.md for universal agents by default', () => {
    const [result] = translateConfig(sampleContent, sampleName, ['universal'])
    expect(result!.filePath).toBe('AGENTS.md')
    expect(result!.content).toBe(sampleContent)
  })

  it('should handle empty content gracefully', () => {
    const [result] = translateConfig('', sampleName, ['claude-code'])
    expect(result!.content).toBe('')
    expect(result!.filePath).toBe('CLAUDE.md')
  })
})

describe('getConfigFilePath', () => {
  it('should return correct path for translators with static paths', () => {
    const expectations: Array<[AgentId, string]> = [
      ['claude-code', 'CLAUDE.md'],
      ['claude-cowork', 'CLAUDE.md'],
      ['cursor', '.cursorrules'],
      ['codex', 'AGENTS.md'],
      ['windsurf', '.windsurfrules'],
      ['copilot', '.github/copilot-instructions.md'],
      ['gemini-cli', 'GEMINI.md'],
      ['goose', '.goose/config.yaml'],
      ['junie', '.junie/guidelines.md'],
      ['aider', '.aider.conf.yml'],
      ['continue', '.continue/config.yaml'],
      ['replit', '.replit'],
    ]

    for (const [agentId, expected] of expectations) {
      expect(getConfigFilePath(agentId, 'test')).toBe(expected)
    }
  })

  it('should return default path for unlisted agents', () => {
    // augment has configDirs[0] = '.augment', so default should be .augment/AGENTS.md
    expect(getConfigFilePath('augment', 'test')).toBe('.augment/AGENTS.md')
  })

  it('should handle dynamic paths (roo, cline)', () => {
    expect(getConfigFilePath('roo', 'my-rules')).toBe('.roo/rules/my-rules.md')
    expect(getConfigFilePath('cline', 'my-rules')).toBe('.clinerules/my-rules.md')
  })
})
