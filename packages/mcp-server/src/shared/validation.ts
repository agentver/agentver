import { homedir } from 'node:os'
import { resolve } from 'node:path'
import { AgentverError } from '@agentver/shared'

/** Only allows alphanumeric, hyphens, underscores, and dots in org/name segments */
export const SAFE_PACKAGE_NAME = /^[a-zA-Z0-9][a-zA-Z0-9._-]*\/[a-zA-Z0-9][a-zA-Z0-9._-]*$/

/** Split a package name into org and package segments, validating the format */
export function splitPackageName(name: string): { org: string; pkg: string } {
  if (!SAFE_PACKAGE_NAME.test(name)) {
    throw new AgentverError(
      'VALIDATION_ERROR',
      `Invalid package name "${name}": expected "org/name" format with alphanumeric, hyphens, underscores, or dots only`
    )
  }

  const slashIndex = name.indexOf('/')
  return { org: name.substring(0, slashIndex), pkg: name.substring(slashIndex + 1) }
}

/** Expand a leading ~ to the user's home directory */
export function expandTilde(filePath: string): string {
  return filePath.replace(/^~(?=\/|$)/, homedir())
}

/** Assert that a resolved path is within the expected base directory */
export function assertPathWithin(filePath: string, baseDir: string): void {
  const resolvedPath = resolve(filePath)
  const resolvedBase = resolve(baseDir)

  if (!resolvedPath.startsWith(`${resolvedBase}/`) && resolvedPath !== resolvedBase) {
    throw new AgentverError(
      'VALIDATION_ERROR',
      `Path "${filePath}" resolves outside the allowed directory "${baseDir}"`
    )
  }
}
