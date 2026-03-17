import type { CLIOutput } from '@agentver/shared'
import { invoke } from '@tauri-apps/api/core'
import type { z } from 'zod'

export type DependencyStatus = {
  found: boolean
  version: string | null
  path: string | null
}

export type PrerequisiteStatus = {
  git: DependencyStatus
  bun: DependencyStatus
  cli: DependencyStatus
}

type CLICommandResult = {
  stdout: string
  stderr: string
  exit_code: number
}

export async function checkPrerequisites(): Promise<PrerequisiteStatus> {
  return invoke<PrerequisiteStatus>('check_prerequisites')
}

export async function installBun(): Promise<string> {
  return invoke<string>('install_bun')
}

export async function installCLI(): Promise<string> {
  return invoke<string>('install_cli')
}

export async function updateCLI(): Promise<string> {
  return invoke<string>('update_cli')
}

export async function getCLIVersion(): Promise<string> {
  return invoke<string>('get_cli_version')
}

export async function runCLI<T>(
  command: string,
  args: string[],
  outputSchema: z.ZodType<T>,
  options?: { cwd?: string }
): Promise<CLIOutput<T>> {
  const result = await invoke<CLICommandResult>('run_cli_command', {
    command,
    args,
    cwd: options?.cwd ?? null,
  })

  if (!result.stdout.trim()) {
    return {
      success: false,
      error: {
        code: 'EMPTY_OUTPUT',
        message: result.stderr || 'CLI returned no output',
      },
    }
  }

  try {
    const parsed = JSON.parse(result.stdout.trim()) as {
      success: boolean
      data?: unknown
      error?: { code: string; message: string }
      warnings?: string[]
    }

    if (!parsed.success) {
      return {
        success: false,
        error: parsed.error ?? {
          code: 'CLI_ERROR',
          message: 'CLI command failed',
        },
        warnings: parsed.warnings,
      }
    }

    const validated = outputSchema.safeParse(parsed.data)
    if (!validated.success) {
      return {
        success: false,
        error: {
          code: 'PARSE_ERROR',
          message: `Failed to parse CLI output: ${validated.error.message}`,
        },
      }
    }

    return {
      success: true,
      data: validated.data,
      warnings: parsed.warnings,
    }
  } catch {
    return {
      success: false,
      error: {
        code: 'INVALID_JSON',
        message: `CLI output was not valid JSON: ${result.stdout.substring(0, 200)}`,
      },
    }
  }
}
