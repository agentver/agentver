/**
 * Global setup for E2E tests — ensures the CLI binary is built before tests run.
 */

import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { findCliRoot } from './helpers'

/** Builds the CLI binary if it does not already exist. */
export function setup(): void {
  const cliRoot = findCliRoot()
  const binPath = resolve(cliRoot, 'dist/agentver.js')

  if (!existsSync(binPath)) {
    execFileSync('bun', ['run', 'build'], { cwd: cliRoot, stdio: 'inherit' })
  }

  if (!existsSync(binPath)) {
    throw new Error(`CLI binary not found at ${binPath} after build. Cannot run E2E tests.`)
  }
}
