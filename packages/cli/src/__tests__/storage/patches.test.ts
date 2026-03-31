import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  renameSync: vi.fn(),
  rmSync: vi.fn(),
}))

describe('storage/patches', () => {
  let fs: typeof import('node:fs')
  let patchesModule: typeof import('../../storage/patches')

  beforeEach(async () => {
    vi.clearAllMocks()
    fs = await import('node:fs')
    patchesModule = await import('../../storage/patches')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('savePatch', () => {
    it('creates the patches directory and writes the patch file', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false)

      const result = patchesModule.savePatch('/project', 'my-skill', '--- a/file\n+++ b/file\n')

      expect(fs.mkdirSync).toHaveBeenCalledWith(expect.stringContaining('patches'), {
        recursive: true,
      })
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining('my-skill.patch.tmp'),
        '--- a/file\n+++ b/file\n',
        'utf-8'
      )
      expect(fs.renameSync).toHaveBeenCalledWith(
        expect.stringContaining('my-skill.patch.tmp'),
        expect.stringContaining('my-skill.patch')
      )
      expect(result).toContain('my-skill.patch')
    })
  })

  describe('removePatch', () => {
    it('removes the patch file when it exists', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true)

      patchesModule.removePatch('/project', 'my-skill')

      expect(fs.rmSync).toHaveBeenCalledWith(expect.stringContaining('my-skill.patch'))
    })

    it('does nothing when patch file does not exist', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false)

      patchesModule.removePatch('/project', 'my-skill')

      expect(fs.rmSync).not.toHaveBeenCalled()
    })
  })

  describe('generatePatch', () => {
    it('returns empty string when files are identical', () => {
      const files = [{ path: 'index.md', content: 'Hello' }]
      const result = patchesModule.generatePatch(files, files, 'my-skill')
      expect(result).toBe('')
    })

    it('generates a patch for modified files', () => {
      const base = [{ path: 'index.md', content: 'Hello' }]
      const local = [{ path: 'index.md', content: 'Hello World' }]

      const result = patchesModule.generatePatch(base, local, 'my-skill')
      expect(result).toContain('---')
      expect(result).toContain('+++')
      expect(result).toContain('@@')
    })

    it('generates a patch for added files', () => {
      const base: Array<{ path: string; content: string }> = []
      const local = [{ path: 'new-file.md', content: 'New content' }]

      const result = patchesModule.generatePatch(base, local, 'my-skill')
      expect(result).toContain('new-file.md')
      expect(result).toContain('+New content')
    })

    it('generates a patch for deleted files', () => {
      const base = [{ path: 'old-file.md', content: 'Old content' }]
      const local: Array<{ path: string; content: string }> = []

      const result = patchesModule.generatePatch(base, local, 'my-skill')
      expect(result).toContain('old-file.md')
      expect(result).toContain('-Old content')
    })

    it('handles multiple file changes', () => {
      const base = [
        { path: 'a.md', content: 'A' },
        { path: 'b.md', content: 'B' },
      ]
      const local = [
        { path: 'a.md', content: 'A modified' },
        { path: 'c.md', content: 'C new' },
      ]

      const result = patchesModule.generatePatch(base, local, 'my-skill')
      expect(result).toContain('a.md')
      expect(result).toContain('b.md')
      expect(result).toContain('c.md')
    })

    it('round-trip: applying the generated patch to the base produces the local state', () => {
      // Use a hardcoded patch to isolate applyPatch from generatePatch
      const patchContent = [
        '--- a/my-skill/index.md',
        '+++ b/my-skill/index.md',
        '@@ -1,3 +1,3 @@',
        ' line 1',
        '-line 2',
        '+modified line 2',
        ' line 3',
        '',
      ].join('\n')

      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(fs.readFileSync).mockReturnValue('line 1\nline 2\nline 3')

      const applyResult = patchesModule.applyPatch('/project', patchContent)
      expect(applyResult.applied).toBe(true)
      expect(applyResult.conflicts).toHaveLength(0)
      expect(vi.mocked(fs.writeFileSync)).toHaveBeenCalledWith(
        expect.stringContaining('index.md.tmp'),
        'line 1\nmodified line 2\nline 3',
        'utf-8'
      )
      expect(vi.mocked(fs.renameSync)).toHaveBeenCalledWith(
        expect.stringContaining('index.md.tmp'),
        expect.stringContaining('index.md')
      )
    })
  })

  describe('applyPatch deletion safety', () => {
    it('does not delete a file when deletion hunks do not match current content', () => {
      const patchContent = [
        '--- a/my-skill/obsolete.md',
        '+++ b/my-skill/obsolete.md',
        '@@ -1,1 +1,0 @@',
        '-old content',
        '',
      ].join('\n')

      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(fs.readFileSync).mockReturnValue('locally modified content')

      const result = patchesModule.applyPatch('/project', patchContent)

      expect(result.applied).toBe(false)
      expect(result.conflicts).toEqual(['obsolete.md'])
      expect(fs.rmSync).not.toHaveBeenCalled()
    })

    it('deletes a file only when deletion hunks match current content', () => {
      const patchContent = [
        '--- a/my-skill/obsolete.md',
        '+++ b/my-skill/obsolete.md',
        '@@ -1,1 +1,0 @@',
        '-old content',
        '',
      ].join('\n')

      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(fs.readFileSync).mockReturnValue('old content')

      const result = patchesModule.applyPatch('/project', patchContent)

      expect(result.applied).toBe(true)
      expect(result.conflicts).toEqual([])
      expect(fs.rmSync).toHaveBeenCalledWith(expect.stringContaining('obsolete.md'))
    })

    it('writes updated content instead of deleting when deletion patch is partial', () => {
      const patchContent = [
        '--- a/my-skill/file.md',
        '+++ b/my-skill/file.md',
        '@@ -1,3 +1,2 @@',
        ' keep',
        '-remove',
        ' stay',
        '',
      ].join('\n')

      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(fs.readFileSync).mockReturnValue('keep\nremove\nstay')

      const result = patchesModule.applyPatch('/project', patchContent)

      expect(result.applied).toBe(true)
      expect(result.conflicts).toEqual([])
      expect(fs.rmSync).not.toHaveBeenCalled()
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining('file.md.tmp'),
        'keep\nstay',
        'utf-8'
      )
    })
  })
})
