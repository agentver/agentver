import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SpinnerLike } from '../output'

describe('output', () => {
  let outputModule: typeof import('../output')
  let stdoutWriteSpy: ReturnType<typeof vi.spyOn>

  beforeEach(async () => {
    vi.resetModules()
    stdoutWriteSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    outputModule = await import('../output')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ---------------------------------------------------------------------------
  // isJSONMode
  // ---------------------------------------------------------------------------

  describe('isJSONMode', () => {
    const originalArgv = process.argv

    afterEach(() => {
      process.argv = originalArgv
    })

    it('should return false by default', () => {
      process.argv = ['node', 'agentver', 'list']
      expect(outputModule.isJSONMode()).toBe(false)
    })

    it('should return true when process.argv includes --json', () => {
      process.argv = ['node', 'agentver', 'list', '--json']
      expect(outputModule.isJSONMode()).toBe(true)
    })

    it('should return true regardless of --json position in argv', () => {
      process.argv = ['node', '--json', 'agentver', 'list']
      expect(outputModule.isJSONMode()).toBe(true)
    })

    it('should not match partial flags like --json-output', () => {
      process.argv = ['node', 'agentver', '--json-output']
      expect(outputModule.isJSONMode()).toBe(false)
    })

    it('should not match --json= variations', () => {
      process.argv = ['node', 'agentver', '--json=true']
      expect(outputModule.isJSONMode()).toBe(false)
    })
  })

  // ---------------------------------------------------------------------------
  // outputSuccess
  // ---------------------------------------------------------------------------

  describe('outputSuccess', () => {
    it('should write valid JSON to stdout with success: true and data', () => {
      const data = { packages: {} }
      outputModule.outputSuccess(data)

      expect(stdoutWriteSpy).toHaveBeenCalledOnce()
      const written = stdoutWriteSpy.mock.calls[0]![0] as string
      const parsed = JSON.parse(written)

      expect(parsed).toEqual({
        success: true,
        data: { packages: {} },
      })
    })

    it('should include warnings when provided', () => {
      const data = { count: 5 }
      const warnings = ['Deprecated format', 'Consider upgrading']

      outputModule.outputSuccess(data, warnings)

      const written = stdoutWriteSpy.mock.calls[0]![0] as string
      const parsed = JSON.parse(written)

      expect(parsed.success).toBe(true)
      expect(parsed.data).toEqual({ count: 5 })
      expect(parsed.warnings).toEqual(['Deprecated format', 'Consider upgrading'])
    })

    it('should omit warnings when array is empty', () => {
      outputModule.outputSuccess({ ok: true }, [])

      const written = stdoutWriteSpy.mock.calls[0]![0] as string
      const parsed = JSON.parse(written)

      expect(parsed).not.toHaveProperty('warnings')
    })

    it('should omit warnings when not provided', () => {
      outputModule.outputSuccess({ ok: true })

      const written = stdoutWriteSpy.mock.calls[0]![0] as string
      const parsed = JSON.parse(written)

      expect(parsed).not.toHaveProperty('warnings')
    })

    it('should terminate output with a newline', () => {
      outputModule.outputSuccess({})

      const written = stdoutWriteSpy.mock.calls[0]![0] as string
      expect(written.endsWith('\n')).toBe(true)
    })

    it('should handle complex nested data', () => {
      const data = {
        packages: {
          'my-skill': {
            source: { type: 'git', uri: 'https://github.com/org/repo' },
            agents: ['claude', 'cursor'],
          },
        },
      }

      outputModule.outputSuccess(data)

      const written = stdoutWriteSpy.mock.calls[0]![0] as string
      const parsed = JSON.parse(written)

      expect(parsed.data.packages['my-skill'].agents).toEqual(['claude', 'cursor'])
    })
  })

  // ---------------------------------------------------------------------------
  // outputError
  // ---------------------------------------------------------------------------

  describe('outputError', () => {
    it('should write valid JSON to stdout with success: false and error object', () => {
      outputModule.outputError('NOT_FOUND', 'Package not found')

      expect(stdoutWriteSpy).toHaveBeenCalledOnce()
      const written = stdoutWriteSpy.mock.calls[0]![0] as string
      const parsed = JSON.parse(written)

      expect(parsed).toEqual({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Package not found' },
      })
    })

    it('should not include a data field', () => {
      outputModule.outputError('VALIDATION_ERROR', 'Invalid input')

      const written = stdoutWriteSpy.mock.calls[0]![0] as string
      const parsed = JSON.parse(written)

      expect(parsed).not.toHaveProperty('data')
    })

    it('should terminate output with a newline', () => {
      outputModule.outputError('ERR', 'Something went wrong')

      const written = stdoutWriteSpy.mock.calls[0]![0] as string
      expect(written.endsWith('\n')).toBe(true)
    })

    it('should handle error messages with special characters', () => {
      outputModule.outputError('ERR', 'Directory "test-skill" already exists.')

      const written = stdoutWriteSpy.mock.calls[0]![0] as string
      const parsed = JSON.parse(written)

      expect(parsed.error.message).toBe('Directory "test-skill" already exists.')
    })
  })

  // ---------------------------------------------------------------------------
  // createSpinner
  // ---------------------------------------------------------------------------

  describe('createSpinner', () => {
    const originalArgv = process.argv

    afterEach(() => {
      process.argv = originalArgv
    })

    it('should return a no-op spinner when in JSON mode', () => {
      process.argv = ['node', 'agentver', 'list', '--json']
      const spinner = outputModule.createSpinner('Loading...')

      // No-op spinner should have the text we passed
      expect(spinner.text).toBe('Loading...')

      // Verify chainability — no-op spinner methods return themselves
      const result = spinner.start()
      expect(result).toBe(spinner)
    })

    it('should return a no-op spinner whose methods do not write to stdout', () => {
      process.argv = ['node', 'agentver', '--json', 'list']
      const spinner = outputModule.createSpinner('Working...') as SpinnerLike

      // Call all methods — none should write to stdout
      spinner.start()
      spinner.succeed('Done')
      spinner.fail('Error')
      spinner.warn('Warning')
      spinner.info('Info')
      spinner.stop()

      // stdout.write should not have been called (only our spy)
      expect(stdoutWriteSpy).not.toHaveBeenCalled()
    })

    it('should return a real ora spinner when not in JSON mode', () => {
      process.argv = ['node', 'agentver', 'list']
      const spinner = outputModule.createSpinner('Loading...')

      // ora spinners have an `id` property and isSpinning accessor
      // that our no-op spinner does not — check for ora-specific properties
      expect(spinner).toHaveProperty('isSpinning')
    })
  })
})
