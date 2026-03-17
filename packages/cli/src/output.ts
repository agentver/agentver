import type { CLIOutput } from '@agentver/shared'
import ora from 'ora'

type Spinner = ReturnType<typeof ora>

export type SpinnerLike = {
  start: () => SpinnerLike
  succeed: (text?: string) => SpinnerLike
  fail: (text?: string) => SpinnerLike
  warn: (text?: string) => SpinnerLike
  info: (text?: string) => SpinnerLike
  stop: () => SpinnerLike
  text: string
}

const noopSpinner: SpinnerLike = {
  start() {
    return this
  },
  succeed() {
    return this
  },
  fail() {
    return this
  },
  warn() {
    return this
  },
  info() {
    return this
  },
  stop() {
    return this
  },
  text: '',
}

/**
 * Check if JSON output mode is active.
 * Reads from process.argv directly since this may be called
 * before Commander parses options.
 */
export function isJSONMode(): boolean {
  return process.argv.includes('--json')
}

/**
 * Output a successful result as JSON to stdout.
 */
export function outputSuccess<T>(data: T, warnings?: string[]): void {
  const output: CLIOutput<T> = { success: true, data }
  if (warnings && warnings.length > 0) {
    output.warnings = warnings
  }
  process.stdout.write(`${JSON.stringify(output)}\n`)
}

/**
 * Output an error as JSON to stdout.
 */
export function outputError(code: string, message: string): void {
  const output: CLIOutput<never> = {
    success: false,
    error: { code, message },
  }
  process.stdout.write(`${JSON.stringify(output)}\n`)
}

/**
 * Create an ora spinner that is silent in JSON mode.
 * Returns a no-op spinner interface when --json is active.
 */
export function createSpinner(text: string): Spinner | SpinnerLike {
  if (isJSONMode()) {
    return { ...noopSpinner, text }
  }
  return ora(text)
}
