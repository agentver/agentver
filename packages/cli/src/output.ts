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
 * Check if verbose output mode is active (--verbose).
 */
export function isVerbose(): boolean {
  return process.argv.includes('--verbose')
}

/**
 * Check if quiet output mode is active (--quiet).
 * Suppresses all non-essential output (spinners, informational messages).
 */
export function isQuiet(): boolean {
  return process.argv.includes('--quiet')
}

/**
 * Get the appropriate tslog minLevel based on CLI flags.
 * verbose=0 (all), default=4 (warn+), quiet=6 (fatal only).
 * Errors if both --verbose and --quiet are passed.
 */
export function getLogLevel(): number {
  if (isVerbose() && isQuiet()) {
    process.stderr.write('Cannot use --verbose and --quiet together.\n')
    process.exit(1)
  }
  if (isVerbose()) return 0
  if (isQuiet()) return 6
  return 4
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
 * Create an ora spinner that is silent in JSON or quiet mode.
 * Returns a no-op spinner interface when --json or --quiet is active.
 */
export function createSpinner(text: string): Spinner | SpinnerLike {
  if (isJSONMode() || isQuiet()) {
    return { ...noopSpinner, text }
  }
  return ora(text)
}
