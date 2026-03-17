import { cn } from '@agentver/ui-utils'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import { Command } from '@tauri-apps/plugin-shell'
import { useState } from 'react'

type RepoWizardProps = {
  open: boolean
  onClose: () => void
  onComplete: (repoPath: string) => void
}
type WizardStep = 'choose' | 'create' | 'connect' | 'confirmation'
type FlowChoice = 'create' | 'connect'
type CreatedResult = { path: string; filesCreated: string[] }
type ConnectedResult = { path: string; skillsFound: number }

const SKILL_TEMPLATE = `---\nname: example-skill\nversion: 0.1.0\ndescription: An example skill to get you started\nauthor: Your Name\n---\n\n# Example Skill\n\nThis is a template skill file. Replace this content with your own skill instructions.\n\n## Usage\n\nDescribe how this skill should be used by an AI agent.\n\n## Rules\n\n- Be concise\n- Follow best practices\n- Handle errors gracefully\n`

async function gitInit(path: string): Promise<void> {
  const result = await Command.create('git', ['init', path]).execute()
  if (result.code !== 0) throw new Error(result.stderr || 'Failed to initialise git repository')
}
async function gitClone(url: string, path: string): Promise<void> {
  const result = await Command.create('git', ['clone', url, path]).execute()
  if (result.code !== 0) throw new Error(result.stderr || 'Failed to clone repository')
}
async function writeFile(path: string, content: string): Promise<void> {
  const result = await Command.create('bash', [
    '-c',
    `cat > "${path}" << 'AGENTVER_EOF'\n${content}\nAGENTVER_EOF`,
  ]).execute()
  if (result.code !== 0) throw new Error(result.stderr || `Failed to write file: ${path}`)
}
async function mkdirp(path: string): Promise<void> {
  const result = await Command.create('mkdir', ['-p', path]).execute()
  if (result.code !== 0) throw new Error(result.stderr || `Failed to create directory: ${path}`)
}
async function countSkillFiles(path: string): Promise<number> {
  const result = await Command.create('bash', [
    '-c',
    `find "${path}" -name "SKILL.md" -o -name "*.skill.md" 2>/dev/null | wc -l`,
  ]).execute()
  if (result.code !== 0) return 0
  return Number.parseInt(result.stdout.trim(), 10) || 0
}

function CloseIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 4l8 8M12 4l-8 8" />
    </svg>
  )
}
function FolderIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M2 5a2 2 0 012-2h3.586a1 1 0 01.707.293l1.414 1.414a1 1 0 00.707.293H16a2 2 0 012 2v8a2 2 0 01-2 2H4a2 2 0 01-2-2V5z" />
    </svg>
  )
}
function GitIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="7" cy="5" r="2" />
      <circle cx="7" cy="15" r="2" />
      <circle cx="15" cy="11" r="2" />
      <path d="M7 7v6" />
      <path d="M7 7c0 4 8 0 8 4" />
    </svg>
  )
}

function ChooseStep({
  onChoice,
  onSkip,
}: {
  onChoice: (choice: FlowChoice) => void
  onSkip: () => void
}) {
  return (
    <div className="flex flex-col gap-5">
      <h2 className="font-[family-name:var(--font-display)] font-semibold text-foreground text-xl tracking-tight">
        Set up a skills repository
      </h2>
      <p className="-mt-2 text-muted-foreground text-sm leading-relaxed">
        A repository stores your agent skills, configs, and prompts. Choose how you&apos;d like to
        get started.
      </p>
      <div className="grid grid-cols-2 gap-3">
        <button
          onClick={() => onChoice('create')}
          className="flex cursor-pointer flex-col items-center gap-3 rounded-2xl border border-border bg-background p-5 text-center font-[inherit] transition-colors hover:border-primary"
        >
          <div className="flex items-center justify-center text-primary">
            <FolderIcon />
          </div>
          <span className="font-semibold text-foreground text-sm">Create new repository</span>
          <span className="text-muted-foreground text-xs leading-snug">
            Initialise a fresh git repo with a starter structure
          </span>
        </button>
        <button
          onClick={() => onChoice('connect')}
          className="flex cursor-pointer flex-col items-center gap-3 rounded-2xl border border-border bg-background p-5 text-center font-[inherit] transition-colors hover:border-primary"
        >
          <div className="flex items-center justify-center text-primary">
            <GitIcon />
          </div>
          <span className="font-semibold text-foreground text-sm">Connect existing repository</span>
          <span className="text-muted-foreground text-xs leading-snug">
            Clone a remote repo or link a local directory
          </span>
        </button>
      </div>
      <button
        onClick={onSkip}
        className="cursor-pointer border-none bg-transparent p-2 text-center font-[inherit] text-[0.825rem] text-muted-foreground transition-colors hover:text-foreground"
      >
        I&apos;ll set this up later
      </button>
    </div>
  )
}

function CreateStep({
  onBack,
  onCreated,
}: {
  onBack: () => void
  onCreated: (result: CreatedResult) => void
}) {
  const [location, setLocation] = useState('')
  const [repoName, setRepoName] = useState('agent-skills')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function handleBrowse() {
    const selected = await openDialog({
      directory: true,
      multiple: false,
      title: 'Choose location for skills repository',
    })
    if (selected && typeof selected === 'string') setLocation(selected)
  }
  async function handleCreate() {
    if (!location || !repoName.trim()) return
    setCreating(true)
    setError(null)
    try {
      const repoPath = `${location}/${repoName.trim()}`
      await mkdirp(`${repoPath}/skills`)
      await mkdirp(`${repoPath}/configs`)
      await mkdirp(`${repoPath}/prompts`)
      await gitInit(repoPath)
      await writeFile(`${repoPath}/skills/SKILL.md`, SKILL_TEMPLATE)
      await writeFile(`${repoPath}/configs/.gitkeep`, '')
      await writeFile(`${repoPath}/prompts/.gitkeep`, '')
      onCreated({
        path: repoPath,
        filesCreated: ['skills/SKILL.md', 'configs/.gitkeep', 'prompts/.gitkeep'],
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create repository')
    } finally {
      setCreating(false)
    }
  }
  return (
    <div className="flex flex-col gap-5">
      <h2 className="font-[family-name:var(--font-display)] font-semibold text-foreground text-xl tracking-tight">
        Create new repository
      </h2>
      <p className="-mt-2 text-muted-foreground text-sm leading-relaxed">
        Choose a location and name for your new skills repository.
      </p>
      <div className="flex flex-col gap-1.5">
        <label className="font-medium text-muted-foreground text-xs tracking-[0.01em]">
          Location
        </label>
        <div className="flex gap-2">
          <input
            type="text"
            value={location}
            readOnly
            placeholder="Select a folder..."
            className="flex-1 rounded-xl border border-border bg-background px-3.5 py-2.5 font-mono text-[0.85rem] text-foreground outline-none"
          />
          <button
            onClick={handleBrowse}
            className="shrink-0 cursor-pointer whitespace-nowrap rounded-xl border border-border bg-muted px-4 py-2.5 font-[inherit] font-medium text-[0.825rem] text-foreground transition-colors hover:bg-accent"
          >
            Browse
          </button>
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <label className="font-medium text-muted-foreground text-xs tracking-[0.01em]">
          Repository name
        </label>
        <input
          type="text"
          value={repoName}
          onChange={(e) => setRepoName(e.target.value)}
          placeholder="agent-skills"
          className="rounded-xl border border-border bg-background px-3.5 py-2.5 font-mono text-[0.85rem] text-foreground outline-none"
        />
        {location && repoName && (
          <span className="text-[0.725rem] text-muted-foreground">
            Will be created at: {location}/{repoName}
          </span>
        )}
      </div>
      {error && (
        <div className="rounded-xl border border-destructive/20 bg-destructive/5 px-3.5 py-2.5 text-[0.825rem] text-destructive leading-snug">
          {error}
        </div>
      )}
      <div className="mt-2 flex justify-end gap-3">
        <button
          onClick={onBack}
          className="cursor-pointer rounded-xl border border-border bg-transparent px-5 py-2.5 font-[inherit] font-medium text-[0.85rem] text-muted-foreground transition-colors hover:text-foreground"
        >
          Back
        </button>
        <button
          onClick={handleCreate}
          disabled={!location || !repoName.trim() || creating}
          className={cn(
            'cursor-pointer rounded-xl border-none bg-primary px-5 py-2.5 font-[inherit] font-medium text-[0.85rem] text-primary-foreground shadow-lg shadow-primary/20 transition-all',
            (!location || !repoName.trim() || creating) && 'cursor-not-allowed opacity-50'
          )}
        >
          {creating ? 'Creating...' : 'Create Repository'}
        </button>
      </div>
    </div>
  )
}

function ConnectStep({
  onBack,
  onConnected,
}: {
  onBack: () => void
  onConnected: (result: ConnectedResult) => void
}) {
  const [mode, setMode] = useState<'url' | 'local'>('url')
  const [repoUrl, setRepoUrl] = useState('')
  const [localPath, setLocalPath] = useState('')
  const [clonePath, setClonePath] = useState('')
  const [connecting, setConnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function handleBrowseLocal() {
    const selected = await openDialog({
      directory: true,
      multiple: false,
      title: 'Select existing repository',
    })
    if (selected && typeof selected === 'string') setLocalPath(selected)
  }
  async function handleBrowseCloneDest() {
    const selected = await openDialog({
      directory: true,
      multiple: false,
      title: 'Choose where to clone the repository',
    })
    if (selected && typeof selected === 'string') setClonePath(selected)
  }
  async function handleConnect() {
    setConnecting(true)
    setError(null)
    try {
      let resultPath: string
      if (mode === 'url') {
        if (!repoUrl.trim() || !clonePath)
          throw new Error('Please provide both a repository URL and a destination folder')
        const repoName =
          repoUrl
            .trim()
            .replace(/\.git$/, '')
            .split('/')
            .pop() ?? 'skills-repo'
        resultPath = `${clonePath}/${repoName}`
        await gitClone(repoUrl.trim(), resultPath)
      } else {
        if (!localPath) throw new Error('Please select a local repository path')
        resultPath = localPath
      }
      const skillsFound = await countSkillFiles(resultPath)
      onConnected({ path: resultPath, skillsFound })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect repository')
    } finally {
      setConnecting(false)
    }
  }
  return (
    <div className="flex flex-col gap-5">
      <h2 className="font-[family-name:var(--font-display)] font-semibold text-foreground text-xl tracking-tight">
        Connect existing repository
      </h2>
      <p className="-mt-2 text-muted-foreground text-sm leading-relaxed">
        Clone a remote repository or link a local directory.
      </p>
      <div className="flex gap-2">
        <button
          onClick={() => setMode('url')}
          className={cn(
            'flex-1 cursor-pointer rounded-xl border px-4 py-2.5 text-center font-[inherit] font-medium text-[0.825rem] transition-all',
            mode === 'url'
              ? 'border-primary bg-accent text-primary'
              : 'border-border bg-card text-muted-foreground hover:bg-muted'
          )}
        >
          Clone from URL
        </button>
        <button
          onClick={() => setMode('local')}
          className={cn(
            'flex-1 cursor-pointer rounded-xl border px-4 py-2.5 text-center font-[inherit] font-medium text-[0.825rem] transition-all',
            mode === 'local'
              ? 'border-primary bg-accent text-primary'
              : 'border-border bg-card text-muted-foreground hover:bg-muted'
          )}
        >
          Local path
        </button>
      </div>
      {mode === 'url' && (
        <>
          <div className="flex flex-col gap-1.5">
            <label className="font-medium text-muted-foreground text-xs tracking-[0.01em]">
              Repository URL
            </label>
            <input
              type="text"
              value={repoUrl}
              onChange={(e) => setRepoUrl(e.target.value)}
              placeholder="https://github.com/user/skills-repo.git"
              className="rounded-xl border border-border bg-background px-3.5 py-2.5 font-mono text-[0.85rem] text-foreground outline-none"
            />
            <span className="text-[0.725rem] text-muted-foreground">
              Supports GitHub, GitLab, Bitbucket, and other git hosts
            </span>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="font-medium text-muted-foreground text-xs tracking-[0.01em]">
              Clone destination
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={clonePath}
                readOnly
                placeholder="Select a folder..."
                className="flex-1 rounded-xl border border-border bg-background px-3.5 py-2.5 font-mono text-[0.85rem] text-foreground outline-none"
              />
              <button
                onClick={handleBrowseCloneDest}
                className="shrink-0 cursor-pointer whitespace-nowrap rounded-xl border border-border bg-muted px-4 py-2.5 font-[inherit] font-medium text-[0.825rem] text-foreground transition-colors hover:bg-accent"
              >
                Browse
              </button>
            </div>
          </div>
        </>
      )}
      {mode === 'local' && (
        <div className="flex flex-col gap-1.5">
          <label className="font-medium text-muted-foreground text-xs tracking-[0.01em]">
            Repository path
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={localPath}
              readOnly
              placeholder="Select repository folder..."
              className="flex-1 rounded-xl border border-border bg-background px-3.5 py-2.5 font-mono text-[0.85rem] text-foreground outline-none"
            />
            <button
              onClick={handleBrowseLocal}
              className="shrink-0 cursor-pointer whitespace-nowrap rounded-xl border border-border bg-muted px-4 py-2.5 font-[inherit] font-medium text-[0.825rem] text-foreground transition-colors hover:bg-accent"
            >
              Browse
            </button>
          </div>
        </div>
      )}
      {error && (
        <div className="rounded-xl border border-destructive/20 bg-destructive/5 px-3.5 py-2.5 text-[0.825rem] text-destructive leading-snug">
          {error}
        </div>
      )}
      <div className="mt-2 flex justify-end gap-3">
        <button
          onClick={onBack}
          className="cursor-pointer rounded-xl border border-border bg-transparent px-5 py-2.5 font-[inherit] font-medium text-[0.85rem] text-muted-foreground transition-colors hover:text-foreground"
        >
          Back
        </button>
        <button
          onClick={handleConnect}
          disabled={connecting}
          className={cn(
            'cursor-pointer rounded-xl border-none bg-primary px-5 py-2.5 font-[inherit] font-medium text-[0.85rem] text-primary-foreground shadow-lg shadow-primary/20 transition-all',
            connecting && 'cursor-not-allowed opacity-50'
          )}
        >
          {connecting ? 'Connecting...' : 'Connect'}
        </button>
      </div>
    </div>
  )
}

function ConfirmationStep({
  result,
  onDone,
}: {
  result: CreatedResult | ConnectedResult
  onDone: () => void
}) {
  const isCreated = 'filesCreated' in result
  async function handleOpenInEditor() {
    try {
      await Command.create('bash', [
        '-c',
        `code "${result.path}" 2>/dev/null || xdg-open "${result.path}" 2>/dev/null || open "${result.path}" 2>/dev/null`,
      ]).execute()
    } catch {
      /* Best effort */
    }
  }
  return (
    <div className="flex flex-col gap-5">
      <div className="flex justify-center">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="10" stroke="#22c55e" strokeWidth="1.5" />
          <path
            d="M8 12l3 3 5-5"
            stroke="#22c55e"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
      <h2 className="text-center font-[family-name:var(--font-display)] font-semibold text-foreground text-xl tracking-tight">
        {isCreated ? 'Repository created' : 'Repository connected'}
      </h2>
      <div className="flex flex-col gap-3 rounded-2xl border border-border bg-background px-5 py-4">
        <div className="flex flex-col gap-1">
          <span className="font-medium text-[0.7rem] text-muted-foreground uppercase tracking-wider">
            Path
          </span>
          <span className="break-all font-mono text-[0.825rem] text-foreground">{result.path}</span>
        </div>
        {isCreated && (
          <div className="flex flex-col gap-1">
            <span className="font-medium text-[0.7rem] text-muted-foreground uppercase tracking-wider">
              Files created
            </span>
            <div className="flex flex-col gap-0.5">
              {result.filesCreated.map((f) => (
                <span key={f} className="font-mono text-muted-foreground text-xs">
                  {f}
                </span>
              ))}
            </div>
          </div>
        )}
        {'skillsFound' in result && (
          <div className="flex flex-col gap-1">
            <span className="font-medium text-[0.7rem] text-muted-foreground uppercase tracking-wider">
              Skills found
            </span>
            <span className="font-mono text-[0.825rem] text-foreground">
              {result.skillsFound} skill{result.skillsFound === 1 ? '' : 's'}
            </span>
          </div>
        )}
      </div>
      <div className="flex justify-center gap-3">
        <button
          onClick={handleOpenInEditor}
          className="cursor-pointer rounded-xl border border-border bg-transparent px-5 py-2.5 font-[inherit] font-medium text-[0.85rem] text-muted-foreground transition-colors hover:text-foreground"
        >
          Open in Editor
        </button>
        <button
          onClick={onDone}
          className="cursor-pointer rounded-xl border-none bg-primary px-5 py-2.5 font-[inherit] font-medium text-[0.85rem] text-primary-foreground shadow-lg shadow-primary/20 transition-colors hover:bg-primary/90"
        >
          Done
        </button>
      </div>
    </div>
  )
}

export function RepoWizard({ open, onClose, onComplete }: RepoWizardProps) {
  const [step, setStep] = useState<WizardStep>('choose')
  const [result, setResult] = useState<CreatedResult | ConnectedResult | null>(null)
  if (!open) return null
  function handleReset() {
    setStep('choose')
    setResult(null)
  }
  function handleSkip() {
    handleReset()
    onClose()
  }
  function handleDone() {
    if (result) onComplete(result.path)
    handleReset()
    onClose()
  }

  return (
    <div
      className="fixed inset-0 z-[200] flex animate-[fadeIn_0.2s_ease-out] items-center justify-center bg-black/60"
      onClick={handleSkip}
    >
      <div
        className="relative max-h-[90vh] w-full max-w-[540px] overflow-y-auto rounded-2xl border border-border bg-card p-8"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={handleSkip}
          className="absolute top-4 right-4 flex cursor-pointer items-center justify-center rounded border-none bg-transparent p-1 text-muted-foreground transition-colors hover:text-foreground"
        >
          <CloseIcon />
        </button>
        <div className="mb-6 flex items-center justify-center">
          {['choose', step === 'create' || step === 'connect' ? step : 'setup', 'confirmation'].map(
            (_s, i) => {
              const stepNum = step === 'choose' ? 0 : step === 'confirmation' ? 2 : 1
              const isActive = i <= stepNum
              return (
                <div key={i} className="flex items-center">
                  <div
                    className={cn(
                      'size-2 shrink-0 rounded-full transition-colors',
                      isActive ? 'bg-primary' : 'bg-muted-foreground/30'
                    )}
                  />
                  {i < 2 && (
                    <div
                      className={cn(
                        'h-0.5 w-[60px] transition-colors',
                        i < stepNum ? 'bg-primary' : 'bg-border'
                      )}
                    />
                  )}
                </div>
              )
            }
          )}
        </div>
        {step === 'choose' && (
          <ChooseStep onChoice={(choice) => setStep(choice)} onSkip={handleSkip} />
        )}
        {step === 'create' && (
          <CreateStep
            onBack={() => setStep('choose')}
            onCreated={(created) => {
              setResult(created)
              setStep('confirmation')
            }}
          />
        )}
        {step === 'connect' && (
          <ConnectStep
            onBack={() => setStep('choose')}
            onConnected={(connected) => {
              setResult(connected)
              setStep('confirmation')
            }}
          />
        )}
        {step === 'confirmation' && result && (
          <ConfirmationStep result={result} onDone={handleDone} />
        )}
      </div>
    </div>
  )
}
