import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FetchedFile } from '../../git/types'
import type { SpinnerLike } from '../../output'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('node:fs', () => ({
  existsSync: vi.fn().mockReturnValue(false),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
}))

vi.mock('../../storage/canonical', () => ({
  getCanonicalSkillPath: vi.fn().mockReturnValue('/project/.agents/skills/test-pkg'),
  createAgentSymlinks: vi.fn(),
}))

// ---------------------------------------------------------------------------
// SUT import (after mocks)
// ---------------------------------------------------------------------------

const { installLocalBundleConstituent } = await import('../../bundle/local-install')

import * as fs from 'node:fs'
import * as canonicalModule from '../../storage/canonical'

function createSpinner(): SpinnerLike {
  return {
    start: vi.fn().mockReturnThis(),
    succeed: vi.fn().mockReturnThis(),
    fail: vi.fn().mockReturnThis(),
    warn: vi.fn().mockReturnThis(),
    info: vi.fn().mockReturnThis(),
    stop: vi.fn().mockReturnThis(),
    text: '',
  } as unknown as SpinnerLike
}

describe('installLocalBundleConstituent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('writes files to canonical path and creates symlinks', async () => {
    const files: FetchedFile[] = [
      { path: 'SKILL.md', content: '# Test', size: 6 },
      { path: 'scripts/run.sh', content: '#!/bin/bash', size: 11 },
    ]
    const spinner = createSpinner()

    await installLocalBundleConstituent('test-pkg', files, ['claude-code'], {}, spinner)

    expect(fs.mkdirSync).toHaveBeenCalled()
    expect(fs.writeFileSync).toHaveBeenCalledTimes(2)
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      expect.stringContaining('SKILL.md'),
      '# Test',
      'utf-8'
    )
    expect(canonicalModule.createAgentSymlinks).toHaveBeenCalledWith(
      expect.any(String),
      'test-pkg',
      ['claude-code'],
      'project'
    )
  })

  it('skips and warns on files with path traversal attempts', async () => {
    const files: FetchedFile[] = [
      { path: '../../../etc/evil', content: 'bad', size: 3 },
      { path: 'SKILL.md', content: '# OK', size: 4 },
    ]
    const spinner = createSpinner()

    await installLocalBundleConstituent('test-pkg', files, ['claude-code'], {}, spinner)

    // Only the safe file should be written
    expect(fs.writeFileSync).toHaveBeenCalledTimes(1)
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      expect.stringContaining('SKILL.md'),
      '# OK',
      'utf-8'
    )

    // Should warn about the traversal path
    expect(spinner.warn).toHaveBeenCalledWith(expect.stringContaining('suspicious path'))
  })

  it('returns early in dry-run mode without writing', async () => {
    const files: FetchedFile[] = [{ path: 'SKILL.md', content: '# Test', size: 6 }]
    const spinner = createSpinner()

    await installLocalBundleConstituent(
      'test-pkg',
      files,
      ['claude-code'],
      { dryRun: true },
      spinner
    )

    expect(fs.writeFileSync).not.toHaveBeenCalled()
    expect(fs.mkdirSync).not.toHaveBeenCalled()
    expect(canonicalModule.createAgentSymlinks).not.toHaveBeenCalled()
    expect(spinner.info).toHaveBeenCalledWith(expect.stringContaining('dry-run'))
  })

  it('uses global scope when options.global is set', async () => {
    const files: FetchedFile[] = [{ path: 'SKILL.md', content: '# Test', size: 6 }]
    const spinner = createSpinner()

    await installLocalBundleConstituent(
      'test-pkg',
      files,
      ['claude-code'],
      { global: true },
      spinner
    )

    expect(canonicalModule.getCanonicalSkillPath).toHaveBeenCalledWith(
      expect.any(String),
      'test-pkg',
      'global'
    )
    expect(canonicalModule.createAgentSymlinks).toHaveBeenCalledWith(
      expect.any(String),
      'test-pkg',
      ['claude-code'],
      'global'
    )
  })
})
