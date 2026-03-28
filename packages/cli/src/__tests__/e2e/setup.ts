/**
 * Global setup for E2E tests — ensures the CLI binary is built before tests run.
 */

import { execSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * Resolve CLI_ROOT relative to this source file.
 * This file lives at packages/cli/src/__tests__/e2e/setup.ts
 * so CLI_ROOT is four levels up.
 */
function findCliRoot(): string {
  // When run as globalSetup, import.meta.url points to the actual file
  const thisFile = new URL(import.meta.url).pathname
  // Walk up from src/__tests__/e2e/setup.ts to packages/cli/
  const parts = thisFile.split('/')
  const srcIndex = parts.lastIndexOf('src')
  if (srcIndex > 0) {
    return parts.slice(0, srcIndex).join('/')
  }
  // Fallback: assume CWD is packages/cli
  return process.cwd()
}

export function setup(): void {
  const cliRoot = findCliRoot()
  const binPath = resolve(cliRoot, 'dist/agentver.js')

  if (!existsSync(binPath)) {
    console.log(`[e2e setup] Building CLI binary in ${cliRoot}...`)
    execSync('npx tsup', { cwd: cliRoot, stdio: 'inherit' })
  }

  if (!existsSync(binPath)) {
    throw new Error(`CLI binary not found at ${binPath} after build. Cannot run E2E tests.`)
  }

  console.log(`[e2e setup] CLI binary ready at ${binPath}`)
}
