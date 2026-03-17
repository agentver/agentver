import { mockInvoke } from '../../__mocks__/tauri'
import type { PrerequisiteStatus } from '../cli-bridge'
import {
  checkSetup,
  createInitialSetupState,
  getGitInstallInstructions,
  installPrerequisite,
} from '../prerequisites'

describe('createInitialSetupState', () => {
  it('returns three steps all in checking status', () => {
    const state = createInitialSetupState()

    expect(state.steps).toHaveLength(3)
    expect(state.steps[0]).toEqual({ id: 'git', label: 'Git', status: 'checking' })
    expect(state.steps[1]).toEqual({ id: 'bun', label: 'Bun Runtime', status: 'checking' })
    expect(state.steps[2]).toEqual({ id: 'cli', label: 'Agentver CLI', status: 'checking' })
  })

  it('returns ready as false', () => {
    const state = createInitialSetupState()
    expect(state.ready).toBe(false)
  })
})

describe('checkSetup', () => {
  beforeEach(() => {
    mockInvoke.mockReset()
  })

  it('maps found dependencies correctly', async () => {
    const status: PrerequisiteStatus = {
      git: { found: true, version: '2.43.0', path: '/usr/bin/git' },
      bun: { found: true, version: '1.3.5', path: '/home/user/.bun/bin/bun' },
      cli: { found: true, version: '0.5.0', path: '/home/user/.bun/bin/agentver' },
    }
    mockInvoke.mockResolvedValue(status)

    const result = await checkSetup()

    expect(result.steps[0]).toMatchObject({ id: 'git', status: 'found', version: '2.43.0' })
    expect(result.steps[1]).toMatchObject({ id: 'bun', status: 'found', version: '1.3.5' })
    expect(result.steps[2]).toMatchObject({ id: 'cli', status: 'found', version: '0.5.0' })
  })

  it('maps missing dependencies correctly', async () => {
    const status: PrerequisiteStatus = {
      git: { found: false, version: null, path: null },
      bun: { found: false, version: null, path: null },
      cli: { found: false, version: null, path: null },
    }
    mockInvoke.mockResolvedValue(status)

    const result = await checkSetup()

    expect(result.steps[0]).toMatchObject({ id: 'git', status: 'missing' })
    expect(result.steps[1]).toMatchObject({ id: 'bun', status: 'missing' })
    expect(result.steps[2]).toMatchObject({ id: 'cli', status: 'missing' })
  })

  it('sets ready to true only when all steps are found', async () => {
    const allFound: PrerequisiteStatus = {
      git: { found: true, version: '2.43.0', path: '/usr/bin/git' },
      bun: { found: true, version: '1.3.5', path: '/usr/bin/bun' },
      cli: { found: true, version: '0.5.0', path: '/usr/bin/agentver' },
    }
    mockInvoke.mockResolvedValue(allFound)

    const resultAllFound = await checkSetup()
    expect(resultAllFound.ready).toBe(true)
  })

  it('sets ready to false when any step is missing', async () => {
    const oneMissing: PrerequisiteStatus = {
      git: { found: true, version: '2.43.0', path: '/usr/bin/git' },
      bun: { found: true, version: '1.3.5', path: '/usr/bin/bun' },
      cli: { found: false, version: null, path: null },
    }
    mockInvoke.mockResolvedValue(oneMissing)

    const result = await checkSetup()
    expect(result.ready).toBe(false)
  })
})

describe('installPrerequisite', () => {
  beforeEach(() => {
    mockInvoke.mockReset()
  })

  it('calls installBun and returns the version on success', async () => {
    mockInvoke.mockResolvedValue('1.3.5')

    const result = await installPrerequisite('bun')

    expect(result.success).toBe(true)
    expect(result.version).toBe('1.3.5')
    expect(mockInvoke).toHaveBeenCalledWith('install_bun')
  })

  it('calls installCLI and returns the version on success', async () => {
    mockInvoke.mockResolvedValue('0.5.0')

    const result = await installPrerequisite('cli')

    expect(result.success).toBe(true)
    expect(result.version).toBe('0.5.0')
    expect(mockInvoke).toHaveBeenCalledWith('install_cli')
  })

  it('returns error on unknown prerequisite id', async () => {
    // @ts-expect-error — testing invalid input
    const result = await installPrerequisite('node')

    expect(result.success).toBe(false)
    expect(result.error).toContain('Unknown prerequisite')
  })

  it('returns error when installation throws', async () => {
    mockInvoke.mockRejectedValue(new Error('Network timeout'))

    const result = await installPrerequisite('bun')

    expect(result.success).toBe(false)
    expect(result.error).toBe('Network timeout')
  })

  it('handles non-Error thrown values', async () => {
    mockInvoke.mockRejectedValue('string error')

    const result = await installPrerequisite('cli')

    expect(result.success).toBe(false)
    expect(result.error).toBe('string error')
  })
})

describe('getGitInstallInstructions', () => {
  it('returns instructions for all platforms', () => {
    const instructions = getGitInstallInstructions()

    expect(instructions).toHaveProperty('macos')
    expect(instructions).toHaveProperty('windows')
    expect(instructions).toHaveProperty('linux')
  })

  it('includes xcode-select for macOS', () => {
    const instructions = getGitInstallInstructions()
    expect(instructions.macos).toContain('xcode-select')
  })

  it('includes git-scm.com for Windows', () => {
    const instructions = getGitInstallInstructions()
    expect(instructions.windows).toContain('git-scm.com')
  })

  it('includes apt install for Linux', () => {
    const instructions = getGitInstallInstructions()
    expect(instructions.linux).toContain('apt install git')
  })
})
