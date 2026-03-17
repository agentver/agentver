import { z } from 'zod'
import { mockInvoke } from '../../__mocks__/tauri'
import { runCLI } from '../cli-bridge'

const testSchema = z.object({
  name: z.string(),
  count: z.number(),
})

describe('runCLI', () => {
  beforeEach(() => {
    mockInvoke.mockReset()
  })

  it('returns parsed data on successful CLI output', async () => {
    mockInvoke.mockResolvedValue({
      stdout: JSON.stringify({
        success: true,
        data: { name: 'test-skill', count: 42 },
      }),
      stderr: '',
      exit_code: 0,
    })

    const result = await runCLI('list', ['--json'], testSchema)

    expect(result.success).toBe(true)
    expect(result.data).toEqual({ name: 'test-skill', count: 42 })
  })

  it('returns EMPTY_OUTPUT error when stdout is empty', async () => {
    mockInvoke.mockResolvedValue({
      stdout: '',
      stderr: 'something went wrong',
      exit_code: 1,
    })

    const result = await runCLI('list', [], testSchema)

    expect(result.success).toBe(false)
    expect(result.error?.code).toBe('EMPTY_OUTPUT')
    expect(result.error?.message).toBe('something went wrong')
  })

  it('returns EMPTY_OUTPUT with default message when stderr is also empty', async () => {
    mockInvoke.mockResolvedValue({
      stdout: '   ',
      stderr: '',
      exit_code: 1,
    })

    const result = await runCLI('list', [], testSchema)

    expect(result.success).toBe(false)
    expect(result.error?.code).toBe('EMPTY_OUTPUT')
    expect(result.error?.message).toBe('CLI returned no output')
  })

  it('returns INVALID_JSON error when stdout is not valid JSON', async () => {
    mockInvoke.mockResolvedValue({
      stdout: 'not json at all',
      stderr: '',
      exit_code: 0,
    })

    const result = await runCLI('list', [], testSchema)

    expect(result.success).toBe(false)
    expect(result.error?.code).toBe('INVALID_JSON')
    expect(result.error?.message).toContain('not valid JSON')
  })

  it('returns CLI_ERROR when CLI reports failure', async () => {
    mockInvoke.mockResolvedValue({
      stdout: JSON.stringify({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Skill not found' },
      }),
      stderr: '',
      exit_code: 1,
    })

    const result = await runCLI('install', ['missing-skill'], testSchema)

    expect(result.success).toBe(false)
    expect(result.error?.code).toBe('NOT_FOUND')
    expect(result.error?.message).toBe('Skill not found')
  })

  it('returns default CLI_ERROR when CLI reports failure without error details', async () => {
    mockInvoke.mockResolvedValue({
      stdout: JSON.stringify({ success: false }),
      stderr: '',
      exit_code: 1,
    })

    const result = await runCLI('install', ['broken'], testSchema)

    expect(result.success).toBe(false)
    expect(result.error?.code).toBe('CLI_ERROR')
    expect(result.error?.message).toBe('CLI command failed')
  })

  it('returns PARSE_ERROR when data does not match schema', async () => {
    mockInvoke.mockResolvedValue({
      stdout: JSON.stringify({
        success: true,
        data: { wrong: 'shape' },
      }),
      stderr: '',
      exit_code: 0,
    })

    const result = await runCLI('list', [], testSchema)

    expect(result.success).toBe(false)
    expect(result.error?.code).toBe('PARSE_ERROR')
    expect(result.error?.message).toContain('Failed to parse CLI output')
  })

  it('passes warnings through from CLI response', async () => {
    mockInvoke.mockResolvedValue({
      stdout: JSON.stringify({
        success: true,
        data: { name: 'test', count: 1 },
        warnings: ['Deprecation notice: v1 format'],
      }),
      stderr: '',
      exit_code: 0,
    })

    const result = await runCLI('list', [], testSchema)

    expect(result.success).toBe(true)
    expect(result.warnings).toEqual(['Deprecation notice: v1 format'])
  })

  it('passes cwd option to invoke', async () => {
    mockInvoke.mockResolvedValue({
      stdout: JSON.stringify({
        success: true,
        data: { name: 'test', count: 1 },
      }),
      stderr: '',
      exit_code: 0,
    })

    await runCLI('list', ['--json'], testSchema, { cwd: '/home/user/project' })

    expect(mockInvoke).toHaveBeenCalledWith('run_cli_command', {
      command: 'list',
      args: ['--json'],
      cwd: '/home/user/project',
    })
  })

  it('passes null cwd when no options are provided', async () => {
    mockInvoke.mockResolvedValue({
      stdout: JSON.stringify({
        success: true,
        data: { name: 'test', count: 1 },
      }),
      stderr: '',
      exit_code: 0,
    })

    await runCLI('list', [], testSchema)

    expect(mockInvoke).toHaveBeenCalledWith('run_cli_command', {
      command: 'list',
      args: [],
      cwd: null,
    })
  })
})
