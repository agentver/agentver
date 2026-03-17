import { checkPrerequisites, installBun, installCLI } from './cli-bridge'

export type SetupStep = {
  id: 'git' | 'bun' | 'cli'
  label: string
  status: 'checking' | 'found' | 'missing' | 'installing' | 'installed' | 'error'
  version?: string
  error?: string
}

export type SetupState = {
  steps: SetupStep[]
  ready: boolean
}

export function createInitialSetupState(): SetupState {
  return {
    steps: [
      { id: 'git', label: 'Git', status: 'checking' },
      { id: 'bun', label: 'Bun Runtime', status: 'checking' },
      { id: 'cli', label: 'Agentver CLI', status: 'checking' },
    ],
    ready: false,
  }
}

export async function checkSetup(): Promise<SetupState> {
  const status = await checkPrerequisites()

  const steps: SetupStep[] = [
    {
      id: 'git',
      label: 'Git',
      status: status.git.found ? 'found' : 'missing',
      version: status.git.version ?? undefined,
    },
    {
      id: 'bun',
      label: 'Bun Runtime',
      status: status.bun.found ? 'found' : 'missing',
      version: status.bun.version ?? undefined,
    },
    {
      id: 'cli',
      label: 'Agentver CLI',
      status: status.cli.found ? 'found' : 'missing',
      version: status.cli.version ?? undefined,
    },
  ]

  return {
    steps,
    ready: steps.every((s) => s.status === 'found'),
  }
}

export async function installPrerequisite(
  id: 'bun' | 'cli'
): Promise<{ success: boolean; version?: string; error?: string }> {
  try {
    if (id === 'bun') {
      const version = await installBun()
      return { success: true, version }
    }
    if (id === 'cli') {
      const version = await installCLI()
      return { success: true, version }
    }
    return { success: false, error: `Unknown prerequisite: ${id}` }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

export function getGitInstallInstructions(): {
  macos: string
  windows: string
  linux: string
} {
  return {
    macos: 'Run: xcode-select --install\nOr download from https://git-scm.com/download/mac',
    windows: 'Download from https://git-scm.com/download/win\nOr run: winget install Git.Git',
    linux: 'Run: sudo apt install git (Debian/Ubuntu)\nOr: sudo dnf install git (Fedora)',
  }
}
