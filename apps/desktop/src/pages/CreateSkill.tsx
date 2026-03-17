import { initResultSchema } from '@agentver/shared'
import { cn } from '@agentver/ui-utils'
import { useState } from 'react'
import { runCLI } from '../lib/cli-bridge'

type SkillType = 'skill' | 'config' | 'plugin' | 'script' | 'prompt'
type CreateSkillProps = { open: boolean; onClose: () => void; onCreated?: () => void }
type WizardStep = 'details' | 'confirm'
type CreatedResult = { name: string; type: string; path: string; files: string[] }

const SKILL_TYPES: { value: SkillType; label: string; description: string }[] = [
  {
    value: 'skill',
    label: 'Skill',
    description: 'A reusable agent skill with rules and instructions',
  },
  {
    value: 'config',
    label: 'Config',
    description: 'Configuration files for agent tools and environments',
  },
  {
    value: 'plugin',
    label: 'Plugin',
    description: 'An extension plugin with custom functionality',
  },
  { value: 'script', label: 'Script', description: 'Executable scripts for automation tasks' },
  { value: 'prompt', label: 'Prompt', description: 'Prompt templates for agent interactions' },
]

function PlusIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 18 18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M9 3v12M3 9h12" />
    </svg>
  )
}
function CheckIcon() {
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
      <path d="M3 8.5l3.5 3.5L13 4" />
    </svg>
  )
}
function FileIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M8 1H3.5a1 1 0 00-1 1v10a1 1 0 001 1h7a1 1 0 001-1V4.5L8 1z" />
      <path d="M8 1v3.5h3.5" />
    </svg>
  )
}

export { PlusIcon }

export function CreateSkill({ open, onClose, onCreated }: CreateSkillProps) {
  const [step, setStep] = useState<WizardStep>('details')
  const [name, setName] = useState('')
  const [skillType, setSkillType] = useState<SkillType>('skill')
  const [description, setDescription] = useState('')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<CreatedResult | null>(null)
  if (!open) return null
  const isNameValid = name.trim().length > 0

  function handleClose() {
    setStep('details')
    setName('')
    setSkillType('skill')
    setDescription('')
    setError(null)
    setResult(null)
    setCreating(false)
    onClose()
  }

  async function handleCreate() {
    setCreating(true)
    setError(null)
    try {
      const args = ['--json', '--name', name.trim(), '--type', skillType]
      if (description.trim()) args.push('--description', description.trim())
      const output = await runCLI('init', args, initResultSchema)
      if (output.success && output.data) {
        setResult(output.data)
        onCreated?.()
      } else setError(output.error?.message ?? 'Failed to create skill')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An unexpected error occurred')
    } finally {
      setCreating(false)
    }
  }

  if (result)
    return (
      <div
        className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/60"
        onClick={handleClose}
      >
        <div
          className="flex max-h-[85vh] w-[500px] max-w-[90%] flex-col gap-4 overflow-y-auto rounded-2xl border border-border bg-card p-6"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center gap-2">
            <div className="flex size-7 items-center justify-center rounded-full border border-green-800 bg-green-950 text-green-500">
              <CheckIcon />
            </div>
            <h2 className="font-semibold text-foreground text-lg">Skill Created</h2>
          </div>
          <div className="flex flex-col gap-2 rounded-lg border border-border bg-muted p-4">
            <div className="flex items-start justify-between gap-4">
              <span className="text-muted-foreground text-xs">Name</span>
              <span className="break-all text-right text-[0.85rem] text-foreground">
                {result.name}
              </span>
            </div>
            <div className="flex items-start justify-between gap-4">
              <span className="text-muted-foreground text-xs">Type</span>
              <span className="break-all text-right text-[0.85rem] text-foreground">
                {result.type}
              </span>
            </div>
            <div className="flex items-start justify-between gap-4">
              <span className="text-muted-foreground text-xs">Path</span>
              <span className="break-all text-right font-mono text-muted-foreground text-xs">
                {result.path}
              </span>
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="font-medium text-muted-foreground text-xs">Created files</span>
            <div className="flex flex-col gap-1">
              {result.files.map((file) => (
                <div
                  key={file}
                  className="flex items-center gap-1.5 rounded bg-muted px-2 py-1.5 text-muted-foreground"
                >
                  <FileIcon />
                  <span className="font-mono text-foreground text-xs">{file}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="flex justify-end">
            <button
              onClick={handleClose}
              className="cursor-pointer rounded-lg border-none bg-primary px-4 py-2 font-[inherit] font-medium text-[0.825rem] text-primary-foreground transition-colors hover:bg-primary/90"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    )

  return (
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/60"
      onClick={handleClose}
    >
      <div
        className="flex max-h-[85vh] w-[500px] max-w-[90%] flex-col gap-4 overflow-y-auto rounded-2xl border border-border bg-card p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-1 flex items-center justify-center">
          <div
            className={cn(
              'size-2.5 rounded-full transition-colors',
              step === 'details' ? 'bg-primary' : 'bg-muted-foreground/30'
            )}
          />
          <div className="h-0.5 w-10 bg-border" />
          <div
            className={cn(
              'size-2.5 rounded-full transition-colors',
              step === 'confirm' ? 'bg-primary' : 'bg-muted-foreground/30'
            )}
          />
        </div>
        <h2 className="font-semibold text-foreground text-lg">Create New Skill</h2>
        {step === 'details' && (
          <>
            <div className="flex flex-col gap-1.5">
              <label className="font-medium text-muted-foreground text-xs">Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="my-skill"
                autoFocus
                className="w-full rounded-lg border border-border bg-card px-3 py-2.5 font-[inherit] text-foreground text-sm outline-none transition-colors focus:border-primary"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="font-medium text-muted-foreground text-xs">Type</label>
              <div className="flex flex-col gap-1.5">
                {SKILL_TYPES.map((t) => (
                  <button
                    key={t.value}
                    onClick={() => setSkillType(t.value)}
                    className={cn(
                      'flex w-full cursor-pointer flex-col gap-0.5 rounded-lg border px-3 py-2.5 text-left font-[inherit] transition-all',
                      skillType === t.value
                        ? 'border-primary bg-accent'
                        : 'border-border bg-card hover:border-foreground/20 hover:bg-muted'
                    )}
                  >
                    <span
                      className={cn(
                        'font-medium text-[0.85rem]',
                        skillType === t.value ? 'text-foreground' : 'text-foreground'
                      )}
                    >
                      {t.label}
                    </span>
                    <span className="text-muted-foreground text-xs leading-tight">
                      {t.description}
                    </span>
                  </button>
                ))}
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="flex items-center gap-1.5 font-medium text-muted-foreground text-xs">
                Description{' '}
                <span className="font-normal text-[0.7rem] text-muted-foreground">optional</span>
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="A brief description of what this skill does..."
                rows={3}
                className="w-full resize-y rounded-lg border border-border bg-card px-3 py-2.5 font-[inherit] text-foreground text-sm outline-none transition-colors focus:border-primary"
              />
            </div>
            <div className="mt-1 flex justify-end gap-2">
              <button
                onClick={handleClose}
                className="cursor-pointer rounded-lg border border-border bg-muted px-4 py-2 font-[inherit] font-medium text-[0.825rem] text-foreground transition-colors hover:bg-accent"
              >
                Cancel
              </button>
              <button
                onClick={() => setStep('confirm')}
                disabled={!isNameValid}
                className={cn(
                  'cursor-pointer rounded-lg border-none px-4 py-2 font-[inherit] font-medium text-[0.825rem] text-primary-foreground transition-colors',
                  isNameValid
                    ? 'bg-primary hover:bg-primary/90'
                    : 'cursor-not-allowed bg-primary/50 opacity-50'
                )}
              >
                Next
              </button>
            </div>
          </>
        )}
        {step === 'confirm' && (
          <>
            <div className="flex flex-col gap-2 rounded-lg border border-border bg-muted p-4">
              <div className="flex items-start justify-between gap-4">
                <span className="text-muted-foreground text-xs">Name</span>
                <span className="break-all text-right text-[0.85rem] text-foreground">
                  {name.trim()}
                </span>
              </div>
              <div className="flex items-start justify-between gap-4">
                <span className="text-muted-foreground text-xs">Type</span>
                <span className="break-all text-right text-[0.85rem] text-foreground">
                  {skillType}
                </span>
              </div>
              {description.trim() && (
                <div className="flex items-start justify-between gap-4">
                  <span className="text-muted-foreground text-xs">Description</span>
                  <span className="break-all text-right text-[0.85rem] text-foreground">
                    {description.trim()}
                  </span>
                </div>
              )}
            </div>
            <p className="text-[0.825rem] text-muted-foreground leading-relaxed">
              This will create a new {skillType} called &ldquo;{name.trim()}&rdquo; in the current
              directory.
            </p>
            {error && (
              <div className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2.5 text-[0.825rem] text-destructive">
                {error}
              </div>
            )}
            <div className="mt-1 flex justify-end gap-2">
              <button
                onClick={() => {
                  setStep('details')
                  setError(null)
                }}
                className="cursor-pointer rounded-lg border border-border bg-muted px-4 py-2 font-[inherit] font-medium text-[0.825rem] text-foreground transition-colors hover:bg-accent"
              >
                Back
              </button>
              <button
                onClick={handleCreate}
                disabled={creating}
                className={cn(
                  'cursor-pointer rounded-lg border-none px-4 py-2 font-[inherit] font-medium text-[0.825rem] text-primary-foreground transition-colors',
                  creating
                    ? 'cursor-wait bg-primary/50 opacity-70'
                    : 'bg-primary hover:bg-primary/90'
                )}
              >
                {creating ? 'Creating...' : 'Create'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
