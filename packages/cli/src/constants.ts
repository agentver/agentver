import { AgentverError } from '@agentver/shared'

export const SEMVER_REGEX = /^\d+\.\d+\.\d+(-[\w.]+)?$/

/**
 * Extract a structured error code and message from an unknown error.
 * Preserves AgentverError codes instead of discarding them.
 */
export function extractError(
  error: unknown,
  fallbackCode: string
): { code: string; message: string } {
  if (error instanceof AgentverError) {
    return { code: error.code, message: error.message }
  }
  if (error instanceof Error) {
    return { code: fallbackCode, message: error.message }
  }
  return { code: fallbackCode, message: String(error) }
}
