import { AgentverError, type AgentverErrorCode, createLogger, SEMVER_REGEX } from '@agentver/shared'
import { getLogLevel } from './output.js'

type CliLogger = ReturnType<typeof createLogger>

export { SEMVER_REGEX }

/**
 * Extract a structured error code and message from an unknown error.
 * Preserves AgentverError codes instead of discarding them.
 */
export function extractError<T extends string>(
  error: unknown,
  fallbackCode: T
): { code: AgentverErrorCode | T; message: string } {
  if (error instanceof AgentverError) {
    return { code: error.code, message: error.message }
  }
  if (error instanceof Error) {
    return { code: fallbackCode, message: error.message }
  }
  return { code: fallbackCode, message: String(error) }
}

/**
 * Create a logger that defers log level resolution until first use.
 * This avoids freezing the level at module import time, which would
 * prevent tests from independently exercising verbose/quiet behaviour.
 */
export function createCliLogger(name: string): CliLogger {
  let instance: CliLogger | undefined
  return new Proxy({} as CliLogger, {
    get(_target, prop, receiver) {
      instance ??= createLogger(name, getLogLevel())
      return Reflect.get(instance, prop, receiver)
    },
  })
}
