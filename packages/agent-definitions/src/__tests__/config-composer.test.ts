import { describe, expect, it } from 'vitest'
import {
  type ComposableConfig,
  composeConfigs,
  isComposedConfig,
  parseComposedSections,
} from '../config-composer'

describe('composeConfigs', () => {
  it('should return empty content for empty input', () => {
    const result = composeConfigs([])
    expect(result.content).toBe('')
    expect(result.sources).toEqual([])
  })

  it('should wrap single config with section marker', () => {
    const configs: ComposableConfig[] = [
      { packageName: '@acme/base', content: 'Use TypeScript strict mode', order: 0 },
    ]
    const result = composeConfigs(configs)
    expect(result.content).toContain('## From: @acme/base')
    expect(result.content).toContain('Use TypeScript strict mode')
    expect(result.sources).toEqual(['@acme/base'])
  })

  it('should compose two configs with section markers', () => {
    const configs: ComposableConfig[] = [
      { packageName: '@acme/base', content: 'Base rules here', order: 0 },
      { packageName: '@acme/overlay', content: 'Overlay rules here', order: 1 },
    ]
    const result = composeConfigs(configs)
    expect(result.content).toContain('## From: @acme/base')
    expect(result.content).toContain('## From: @acme/overlay')
    expect(result.content).toContain('Base rules here')
    expect(result.content).toContain('Overlay rules here')
  })

  it('should sort configs by order field', () => {
    const configs: ComposableConfig[] = [
      { packageName: 'second', content: 'Second content', order: 2 },
      { packageName: 'first', content: 'First content', order: 1 },
    ]
    const result = composeConfigs(configs)
    expect(result.sources).toEqual(['first', 'second'])
    const firstIdx = result.content.indexOf('## From: first')
    const secondIdx = result.content.indexOf('## From: second')
    expect(firstIdx).toBeLessThan(secondIdx)
  })

  it('should deduplicate lines from base config that appear in overlays', () => {
    const configs: ComposableConfig[] = [
      { packageName: 'base', content: 'Use TypeScript\nUse strict mode\nWrite tests', order: 0 },
      { packageName: 'overlay', content: 'Use TypeScript\nCustom overlay rule', order: 1 },
    ]
    const result = composeConfigs(configs)
    // "Use TypeScript" should NOT appear in the base section (it's in the overlay)
    const sections = result.content.split('## From:')
    const baseSection = sections[1]! // after "## From: base"
    expect(baseSection).not.toContain('Use TypeScript')
    expect(baseSection).toContain('Use strict mode')
    expect(baseSection).toContain('Write tests')
  })

  it('should preserve unique base config lines', () => {
    const configs: ComposableConfig[] = [
      { packageName: 'base', content: 'Unique base line\nShared line', order: 0 },
      { packageName: 'overlay', content: 'Shared line\nOverlay line', order: 1 },
    ]
    const result = composeConfigs(configs)
    expect(result.content).toContain('Unique base line')
  })

  it('should filter out empty configs', () => {
    const configs: ComposableConfig[] = [
      { packageName: 'base', content: 'Has content', order: 0 },
      { packageName: 'empty', content: '', order: 1 },
    ]
    const result = composeConfigs(configs)
    // The empty config should not produce a section
    expect(result.content).not.toContain('## From: empty')
    // But sources list still includes it (sorted order maps all)
    expect(result.sources).toContain('empty')
  })

  it('should trim whitespace before duplicate comparison', () => {
    const configs: ComposableConfig[] = [
      { packageName: 'base', content: '  Use TypeScript  \nUnique base line', order: 0 },
      { packageName: 'overlay', content: 'Use TypeScript', order: 1 },
    ]
    const result = composeConfigs(configs)
    // The trimmed "Use TypeScript" should be considered a duplicate and removed from base
    expect(result.content).toContain('## From: base')
    expect(result.content).toContain('Unique base line')
    // Base section should not contain the duplicated line
    const baseSectionStart = result.content.indexOf('## From: base')
    const overlaySectionStart = result.content.indexOf('## From: overlay')
    const baseSection = result.content.slice(baseSectionStart, overlaySectionStart)
    expect(baseSection).not.toContain('Use TypeScript')
  })

  it('should return correct sources list', () => {
    const configs: ComposableConfig[] = [
      { packageName: 'alpha', content: 'A', order: 0 },
      { packageName: 'beta', content: 'B', order: 1 },
    ]
    const result = composeConfigs(configs)
    expect(result.sources).toEqual(['alpha', 'beta'])
  })

  it('should handle three or more configs', () => {
    const configs: ComposableConfig[] = [
      { packageName: 'base', content: 'Base', order: 0 },
      { packageName: 'mid', content: 'Mid', order: 1 },
      { packageName: 'top', content: 'Top', order: 2 },
    ]
    const result = composeConfigs(configs)
    expect(result.sources).toEqual(['base', 'mid', 'top'])
    expect(result.content).toContain('## From: base')
    expect(result.content).toContain('## From: mid')
    expect(result.content).toContain('## From: top')
  })

  it('should handle configs with same order value', () => {
    const configs: ComposableConfig[] = [
      { packageName: 'a', content: 'Content A', order: 1 },
      { packageName: 'b', content: 'Content B', order: 1 },
    ]
    const result = composeConfigs(configs)
    // Both should appear
    expect(result.sources).toHaveLength(2)
    expect(result.content).toContain('Content A')
    expect(result.content).toContain('Content B')
  })
})

describe('isComposedConfig', () => {
  it('should return true for content with section markers', () => {
    const content = '## From: @acme/base\n\nSome content here'
    expect(isComposedConfig(content)).toBe(true)
  })

  it('should return false for regular markdown', () => {
    const content = '# My Config\n\nJust regular markdown'
    expect(isComposedConfig(content)).toBe(false)
  })

  it('should return false for empty string', () => {
    expect(isComposedConfig('')).toBe(false)
  })

  it('should return false for partial markers', () => {
    expect(isComposedConfig('## From')).toBe(false)
    expect(isComposedConfig('## From:')).toBe(false)
  })

  it('should only match markers at line start', () => {
    const content = 'Some text ## From: package\nMore text'
    // The regex uses ^ with gm, so "## From:" must be at start of a line
    // In this case "Some text ## From: package" — "## From:" is NOT at line start
    expect(isComposedConfig(content)).toBe(false)
  })
})

describe('parseComposedSections', () => {
  it('should extract sections from composed config', () => {
    const content = '## From: @acme/base\n\nBase rules\n\n## From: @acme/overlay\n\nOverlay rules'
    const sections = parseComposedSections(content)
    expect(sections).toHaveLength(2)
    expect(sections[0]!.packageName).toBe('@acme/base')
    expect(sections[0]!.content).toBe('Base rules')
    expect(sections[1]!.packageName).toBe('@acme/overlay')
    expect(sections[1]!.content).toBe('Overlay rules')
  })

  it('should return empty array for non-composed content', () => {
    const content = '# Just a regular file\n\nNothing special'
    const sections = parseComposedSections(content)
    expect(sections).toEqual([])
  })

  it('should filter out empty sections', () => {
    const content = '## From: @acme/base\n\nContent\n\n## From: @acme/empty\n\n'
    const sections = parseComposedSections(content)
    // The second section has empty body, should be filtered
    expect(sections).toHaveLength(1)
    expect(sections[0]!.packageName).toBe('@acme/base')
  })

  it('should preserve section order', () => {
    const content =
      '## From: first\n\nFirst content\n\n## From: second\n\nSecond content\n\n## From: third\n\nThird content'
    const sections = parseComposedSections(content)
    expect(sections.map((s) => s.packageName)).toEqual(['first', 'second', 'third'])
  })

  it('should handle round-trip: compose then parse', () => {
    const configs: ComposableConfig[] = [
      { packageName: 'base', content: 'Base rules', order: 0 },
      { packageName: 'overlay', content: 'Overlay rules', order: 1 },
    ]
    const composed = composeConfigs(configs)
    const parsed = parseComposedSections(composed.content)
    expect(parsed).toHaveLength(2)
    expect(parsed[0]!.packageName).toBe('base')
    expect(parsed[0]!.content).toBe('Base rules')
    expect(parsed[1]!.packageName).toBe('overlay')
    expect(parsed[1]!.content).toBe('Overlay rules')
  })

  it('should handle multiple sections with same package name', () => {
    const content = '## From: same-pkg\n\nFirst block\n\n## From: same-pkg\n\nSecond block'
    const sections = parseComposedSections(content)
    expect(sections).toHaveLength(2)
    expect(sections[0]!.packageName).toBe('same-pkg')
    expect(sections[1]!.packageName).toBe('same-pkg')
  })
})
