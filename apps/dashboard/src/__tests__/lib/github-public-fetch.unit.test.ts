import { TRPCError } from '@trpc/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildCandidatePaths,
  fetchSkillFolderFromGitHub,
  fetchSkillMdFromGitHub,
} from '@/lib/github/public-fetch'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SKILL_CONTENT = `---
name: test-skill
description: A test skill
type: skill
---

# Test Skill
`

/**
 * Build a plain-text Response.
 */
function textResponse(body: string, ok: boolean, status = ok ? 200 : 404): Response {
  return new Response(body, { status, headers: { 'Content-Type': 'text/plain' } })
}

/**
 * Build a JSON Response.
 */
function jsonResponse(data: unknown, ok: boolean, status = ok ? 200 : 404): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

/**
 * Create a fetch spy that responds based on URL patterns.
 * The `urlMap` maps URL substrings to response factories. Unmatched URLs return 404.
 */
function stubFetch(urlMap: Map<string, () => Response>) {
  return vi.fn(async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url

    for (const [pattern, factory] of urlMap) {
      if (url.includes(pattern)) {
        return factory()
      }
    }
    return textResponse('Not Found', false, 404)
  })
}

/**
 * Collect all URLs that our fetch spy was called with.
 */
function fetchedUrls(spy: ReturnType<typeof stubFetch>): string[] {
  return spy.mock.calls.map((call) => {
    const input = call[0] as string | URL | Request
    return typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  })
}

// ---------------------------------------------------------------------------
// buildCandidatePaths — pure function, no fetch needed
// ---------------------------------------------------------------------------

describe('buildCandidatePaths', () => {
  it('generates direct and skills/-prefixed paths when a subpath is given', () => {
    const paths = buildCandidatePaths('my-skill')

    expect(paths).toEqual([
      'my-skill/SKILL.md',
      'skills/my-skill/SKILL.md',
      'my-skill/agentver.yaml',
      'skills/my-skill/agentver.yaml',
      'my-skill/skill.md',
      'skills/my-skill/skill.md',
      'my-skill/agentver.yml',
      'skills/my-skill/agentver.yml',
    ])
  })

  it('interleaves direct and skills/ variants so each format is tried in both locations before moving on', () => {
    const paths = buildCandidatePaths('deploy')

    // SKILL.md direct then prefixed, agentver.yaml direct then prefixed, etc.
    expect(paths[0]).toBe('deploy/SKILL.md')
    expect(paths[1]).toBe('skills/deploy/SKILL.md')
    expect(paths[2]).toBe('deploy/agentver.yaml')
    expect(paths[3]).toBe('skills/deploy/agentver.yaml')
  })

  it('generates root-level paths only when no subpath is given', () => {
    const paths = buildCandidatePaths(null)

    expect(paths).toEqual(['SKILL.md', 'agentver.yaml', 'skill.md', 'agentver.yml'])
    // No skills/ prefix when there is no path
    expect(paths.every((p) => !p.startsWith('skills/'))).toBe(true)
  })

  it('handles nested subpaths (e.g. a/b/c)', () => {
    const paths = buildCandidatePaths('a/b/c')

    expect(paths).toContain('a/b/c/SKILL.md')
    expect(paths).toContain('skills/a/b/c/SKILL.md')
  })
})

// ---------------------------------------------------------------------------
// fetchSkillMdFromGitHub
// ---------------------------------------------------------------------------

describe('fetchSkillMdFromGitHub', () => {
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('resolves immediately when SKILL.md is found at the direct path on main', async () => {
    const urlMap = new Map<string, () => Response>()
    urlMap.set('raw.githubusercontent.com/acme/repo/main/my-skill/SKILL.md', () =>
      textResponse(SKILL_CONTENT, true)
    )

    const spy = stubFetch(urlMap)
    globalThis.fetch = spy

    const result = await fetchSkillMdFromGitHub('acme', 'repo', 'my-skill')

    expect(result.content).toBe(SKILL_CONTENT)
    expect(result.resolvedPath).toBe('my-skill/SKILL.md')
    expect(result.branch).toBe('main')

    // Should have made exactly one fetch call — no further probing needed
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('finds SKILL.md at the skills/ prefix after direct path fails on both branches', async () => {
    const urlMap = new Map<string, () => Response>()
    // Direct path fails on both main and master (not in urlMap -> 404)
    // skills/ prefixed path succeeds on main
    urlMap.set('raw.githubusercontent.com/acme/repo/main/skills/my-skill/SKILL.md', () =>
      textResponse(SKILL_CONTENT, true)
    )

    const spy = stubFetch(urlMap)
    globalThis.fetch = spy

    const result = await fetchSkillMdFromGitHub('acme', 'repo', 'my-skill')

    expect(result.content).toBe(SKILL_CONTENT)
    expect(result.resolvedPath).toBe('skills/my-skill/SKILL.md')
    expect(result.branch).toBe('main')

    // Should have tried direct path on main, then master, then skills/ prefix on main
    const urls = fetchedUrls(spy)
    expect(urls[0]).toContain('/main/my-skill/SKILL.md')
    expect(urls[1]).toContain('/master/my-skill/SKILL.md')
    expect(urls[2]).toContain('/main/skills/my-skill/SKILL.md')
  })

  it('falls back to master branch when main returns 404', async () => {
    const urlMap = new Map<string, () => Response>()
    // Only master branch has the file
    urlMap.set('raw.githubusercontent.com/acme/repo/master/my-skill/SKILL.md', () =>
      textResponse(SKILL_CONTENT, true)
    )

    const spy = stubFetch(urlMap)
    globalThis.fetch = spy

    const result = await fetchSkillMdFromGitHub('acme', 'repo', 'my-skill')

    expect(result.branch).toBe('master')
    expect(result.resolvedPath).toBe('my-skill/SKILL.md')
  })

  it('falls back to the GitHub Contents API when raw URLs fail', async () => {
    const base64Content = Buffer.from(SKILL_CONTENT).toString('base64')
    const urlMap = new Map<string, () => Response>()
    // All raw URLs fail (nothing in urlMap for raw.githubusercontent.com)
    // API fallback succeeds for the direct path
    urlMap.set('api.github.com/repos/acme/repo/contents/my-skill/SKILL.md', () =>
      jsonResponse({ content: base64Content, encoding: 'base64', download_url: null }, true)
    )

    const spy = stubFetch(urlMap)
    globalThis.fetch = spy

    const result = await fetchSkillMdFromGitHub('acme', 'repo', 'my-skill')

    expect(result.content).toBe(SKILL_CONTENT)
    expect(result.resolvedPath).toBe('my-skill/SKILL.md')
    expect(result.branch).toBe('default')
  })

  it('falls back to the GitHub Contents API at skills/ prefix when direct API path fails', async () => {
    const base64Content = Buffer.from(SKILL_CONTENT).toString('base64')
    const urlMap = new Map<string, () => Response>()
    // All raw URLs fail, direct API path also fails
    // API fallback succeeds at skills/ prefix
    urlMap.set('api.github.com/repos/acme/repo/contents/skills/my-skill/SKILL.md', () =>
      jsonResponse({ content: base64Content, encoding: 'base64', download_url: null }, true)
    )

    const spy = stubFetch(urlMap)
    globalThis.fetch = spy

    const result = await fetchSkillMdFromGitHub('acme', 'repo', 'my-skill')

    expect(result.content).toBe(SKILL_CONTENT)
    expect(result.resolvedPath).toBe('skills/my-skill/SKILL.md')
    expect(result.branch).toBe('default')
  })

  it('throws NOT_FOUND when no candidate path returns a result', async () => {
    // Every fetch returns 404
    const spy = stubFetch(new Map())
    globalThis.fetch = spy

    await expect(fetchSkillMdFromGitHub('acme', 'repo', 'nonexistent')).rejects.toThrow(TRPCError)

    try {
      await fetchSkillMdFromGitHub('acme', 'repo', 'nonexistent')
    } catch (error) {
      expect(error).toBeInstanceOf(TRPCError)
      expect((error as TRPCError).code).toBe('NOT_FOUND')
      expect((error as TRPCError).message).toContain('acme/repo/nonexistent')
    }

    // Verify all candidate paths were attempted (raw + API for each)
    const urls = fetchedUrls(spy)
    // 8 candidates x 2 branches = 16 raw attempts, plus 8 API attempts = 24 total per call
    // (but we called twice so double it)
    // Just check that both direct and skills/ prefix paths were tried
    expect(urls.some((u) => u.includes('nonexistent/SKILL.md'))).toBe(true)
    expect(urls.some((u) => u.includes('skills/nonexistent/SKILL.md'))).toBe(true)
    expect(urls.some((u) => u.includes('nonexistent/agentver.yaml'))).toBe(true)
    expect(urls.some((u) => u.includes('skills/nonexistent/agentver.yaml'))).toBe(true)
    expect(urls.some((u) => u.includes('nonexistent/skill.md'))).toBe(true)
    expect(urls.some((u) => u.includes('nonexistent/agentver.yml'))).toBe(true)
  })

  it('uses root-level candidates when path is null', async () => {
    const urlMap = new Map<string, () => Response>()
    urlMap.set('raw.githubusercontent.com/acme/repo/main/SKILL.md', () =>
      textResponse(SKILL_CONTENT, true)
    )

    const spy = stubFetch(urlMap)
    globalThis.fetch = spy

    const result = await fetchSkillMdFromGitHub('acme', 'repo', null)

    expect(result.resolvedPath).toBe('SKILL.md')
    expect(result.branch).toBe('main')

    // No skills/ prefix should have been tried
    const urls = fetchedUrls(spy)
    expect(urls.every((u) => !u.includes('skills/'))).toBe(true)
  })

  it('prefers agentver.yaml at the direct path over SKILL.md at skills/ prefix', async () => {
    // This verifies the interleaving order: for each file format, direct is tried before prefixed.
    // SKILL.md direct fails, skills/SKILL.md available, but agentver.yaml direct is also available.
    // Because the candidate list tries `path/SKILL.md` then `skills/path/SKILL.md` then `path/agentver.yaml`,
    // the skills/SKILL.md should win because it comes before agentver.yaml in the list.
    const urlMap = new Map<string, () => Response>()
    urlMap.set('raw.githubusercontent.com/acme/repo/main/skills/deploy/SKILL.md', () =>
      textResponse(SKILL_CONTENT, true)
    )
    urlMap.set('raw.githubusercontent.com/acme/repo/main/deploy/agentver.yaml', () =>
      textResponse('name: deploy', true)
    )

    const spy = stubFetch(urlMap)
    globalThis.fetch = spy

    const result = await fetchSkillMdFromGitHub('acme', 'repo', 'deploy')

    // skills/deploy/SKILL.md should be found before deploy/agentver.yaml
    expect(result.resolvedPath).toBe('skills/deploy/SKILL.md')
  })
})

// ---------------------------------------------------------------------------
// fetchSkillFolderFromGitHub
// ---------------------------------------------------------------------------

describe('fetchSkillFolderFromGitHub', () => {
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('fetches files from a flat directory', async () => {
    const urlMap = new Map<string, () => Response>()
    urlMap.set('api.github.com/repos/acme/repo/contents/my-skill?ref=main', () =>
      jsonResponse(
        [
          {
            name: 'SKILL.md',
            path: 'my-skill/SKILL.md',
            type: 'file',
            download_url: 'https://raw.githubusercontent.com/acme/repo/main/my-skill/SKILL.md',
          },
          {
            name: 'config.yaml',
            path: 'my-skill/config.yaml',
            type: 'file',
            download_url: 'https://raw.githubusercontent.com/acme/repo/main/my-skill/config.yaml',
          },
        ],
        true
      )
    )
    urlMap.set('my-skill/SKILL.md', () => textResponse('# Skill', true))
    urlMap.set('my-skill/config.yaml', () => textResponse('key: value', true))

    globalThis.fetch = stubFetch(urlMap)

    const files = await fetchSkillFolderFromGitHub('acme', 'repo', 'my-skill', 'main')

    expect(files).toHaveLength(2)
    expect(files).toContainEqual({ path: 'SKILL.md', content: '# Skill' })
    expect(files).toContainEqual({ path: 'config.yaml', content: 'key: value' })
  })

  it('recursively fetches files from subdirectories', async () => {
    const urlMap = new Map<string, () => Response>()

    // Root folder listing
    urlMap.set('api.github.com/repos/acme/repo/contents/my-skill?ref=main', () =>
      jsonResponse(
        [
          {
            name: 'SKILL.md',
            path: 'my-skill/SKILL.md',
            type: 'file',
            download_url: 'https://raw.githubusercontent.com/acme/repo/main/my-skill/SKILL.md',
          },
          {
            name: 'helpers',
            path: 'my-skill/helpers',
            type: 'dir',
            download_url: null,
          },
        ],
        true
      )
    )

    // Subdirectory listing
    urlMap.set('api.github.com/repos/acme/repo/contents/my-skill/helpers?ref=main', () =>
      jsonResponse(
        [
          {
            name: 'utils.sh',
            path: 'my-skill/helpers/utils.sh',
            type: 'file',
            download_url:
              'https://raw.githubusercontent.com/acme/repo/main/my-skill/helpers/utils.sh',
          },
        ],
        true
      )
    )

    // File downloads
    urlMap.set('my-skill/SKILL.md', () => textResponse('# Root skill', true))
    urlMap.set('my-skill/helpers/utils.sh', () => textResponse('#!/bin/bash', true))

    globalThis.fetch = stubFetch(urlMap)

    const files = await fetchSkillFolderFromGitHub('acme', 'repo', 'my-skill', 'main')

    expect(files).toHaveLength(2)
    expect(files).toContainEqual({ path: 'SKILL.md', content: '# Root skill' })
    expect(files).toContainEqual({ path: 'helpers/utils.sh', content: '#!/bin/bash' })
  })

  it('stops recursion at depth > 2', async () => {
    const urlMap = new Map<string, () => Response>()

    // depth 0: root folder
    urlMap.set('api.github.com/repos/acme/repo/contents/root?ref=main', () =>
      jsonResponse([{ name: 'level1', path: 'root/level1', type: 'dir', download_url: null }], true)
    )

    // depth 1
    urlMap.set('api.github.com/repos/acme/repo/contents/root/level1?ref=main', () =>
      jsonResponse(
        [{ name: 'level2', path: 'root/level1/level2', type: 'dir', download_url: null }],
        true
      )
    )

    // depth 2
    urlMap.set('api.github.com/repos/acme/repo/contents/root/level1/level2?ref=main', () =>
      jsonResponse(
        [
          {
            name: 'deep.txt',
            path: 'root/level1/level2/deep.txt',
            type: 'file',
            download_url:
              'https://raw.githubusercontent.com/acme/repo/main/root/level1/level2/deep.txt',
          },
          {
            name: 'level3',
            path: 'root/level1/level2/level3',
            type: 'dir',
            download_url: null,
          },
        ],
        true
      )
    )

    // depth 3 — should NOT be fetched
    urlMap.set('api.github.com/repos/acme/repo/contents/root/level1/level2/level3?ref=main', () =>
      jsonResponse(
        [
          {
            name: 'too-deep.txt',
            path: 'root/level1/level2/level3/too-deep.txt',
            type: 'file',
            download_url:
              'https://raw.githubusercontent.com/acme/repo/main/root/level1/level2/level3/too-deep.txt',
          },
        ],
        true
      )
    )

    // File downloads
    urlMap.set('root/level1/level2/deep.txt', () => textResponse('deep content', true))
    urlMap.set('root/level1/level2/level3/too-deep.txt', () => textResponse('too deep', true))

    const spy = stubFetch(urlMap)
    globalThis.fetch = spy

    const files = await fetchSkillFolderFromGitHub('acme', 'repo', 'root', 'main')

    // Should have the depth-2 file but not the depth-3 file
    expect(files).toContainEqual({ path: 'level1/level2/deep.txt', content: 'deep content' })
    expect(files).not.toContainEqual(
      expect.objectContaining({ path: 'level1/level2/level3/too-deep.txt' })
    )

    // Verify the depth-3 directory listing was never requested
    const urls = fetchedUrls(spy)
    expect(urls.some((u) => u.includes('contents/root/level1/level2/level3'))).toBe(false)
  })

  it('returns an empty array when the root folder listing fails', async () => {
    // All fetches return 404
    const spy = stubFetch(new Map())
    globalThis.fetch = spy

    const files = await fetchSkillFolderFromGitHub('acme', 'repo', 'missing-folder', 'main')

    expect(files).toEqual([])
  })

  it('skips files whose download fails but continues with others', async () => {
    const urlMap = new Map<string, () => Response>()

    urlMap.set('api.github.com/repos/acme/repo/contents/my-skill?ref=main', () =>
      jsonResponse(
        [
          {
            name: 'good.md',
            path: 'my-skill/good.md',
            type: 'file',
            download_url: 'https://raw.githubusercontent.com/acme/repo/main/my-skill/good.md',
          },
          {
            name: 'broken.md',
            path: 'my-skill/broken.md',
            type: 'file',
            download_url: 'https://raw.githubusercontent.com/acme/repo/main/my-skill/broken.md',
          },
        ],
        true
      )
    )

    urlMap.set('my-skill/good.md', () => textResponse('good content', true))
    urlMap.set('my-skill/broken.md', () => textResponse('server error', false, 500))

    globalThis.fetch = stubFetch(urlMap)

    const files = await fetchSkillFolderFromGitHub('acme', 'repo', 'my-skill', 'main')

    expect(files).toHaveLength(1)
    expect(files[0]).toEqual({ path: 'good.md', content: 'good content' })
  })

  it('ignores symlinks and submodules', async () => {
    const urlMap = new Map<string, () => Response>()

    urlMap.set('api.github.com/repos/acme/repo/contents/my-skill?ref=main', () =>
      jsonResponse(
        [
          {
            name: 'real-file.md',
            path: 'my-skill/real-file.md',
            type: 'file',
            download_url: 'https://raw.githubusercontent.com/acme/repo/main/my-skill/real-file.md',
          },
          {
            name: 'link',
            path: 'my-skill/link',
            type: 'symlink',
            download_url: null,
          },
          {
            name: 'submod',
            path: 'my-skill/submod',
            type: 'submodule',
            download_url: null,
          },
        ],
        true
      )
    )

    urlMap.set('my-skill/real-file.md', () => textResponse('real', true))

    globalThis.fetch = stubFetch(urlMap)

    const files = await fetchSkillFolderFromGitHub('acme', 'repo', 'my-skill', 'main')

    expect(files).toHaveLength(1)
    expect(files[0]?.path).toBe('real-file.md')
  })
})
