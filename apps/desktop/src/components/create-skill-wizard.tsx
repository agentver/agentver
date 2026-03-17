import { initResultSchema } from '@agentver/shared'
import { cn } from '@agentver/ui-utils'
import { useState } from 'react'
import { useAgents } from '../hooks/useAgents'
import { runCLI } from '../lib/cli-bridge'

type SkillKind = 'skill' | 'config' | 'prompt'
type WizardStep = 'type' | 'details' | 'agents' | 'location'
type CreateSkillWizardProps = {
  open: boolean
  onClose: () => void
  onCreated?: (path: string) => void
}
type CreatedResult = { name: string; type: string; path: string; files: string[] }

const SKILL_KINDS: { value: SkillKind; label: string; description: string }[] = [
  {
    value: 'skill',
    label: 'Skill',
    description: 'A reusable agent skill with rules, instructions, and configuration',
  },
  {
    value: 'config',
    label: 'Config',
    description: 'Configuration files for agent tools, environments, and preferences',
  },
  {
    value: 'prompt',
    label: 'Prompt',
    description: 'Prompt templates for agent interactions and workflows',
  },
]

function DetailRow({
  label,
  value,
  valueStyle,
}: {
  label: string
  value: string
  valueStyle?: React.CSSProperties
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="shrink-0 text-muted-foreground text-xs">{label}</span>
      <span className="break-all text-right text-[0.85rem] text-foreground" style={valueStyle}>
        {value}
      </span>
    </div>
  )
}

export function CreateSkillWizard({ open, onClose, onCreated }: CreateSkillWizardProps) {
  const [step, setStep] = useState<WizardStep>('type')
  const [kind, setKind] = useState<SkillKind>('skill')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [selectedAgents, setSelectedAgents] = useState<string[]>([])
  const [location, setLocation] = useState<'project' | 'global'>('project')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<CreatedResult | null>(null)
  const { agents } = useAgents()

  if (!open) return null
  const steps: WizardStep[] = ['type', 'details', 'agents', 'location']
  const currentStepIndex = steps.indexOf(step)

  function handleClose() {
    setStep('type')
    setKind('skill')
    setName('')
    setDescription('')
    setSelectedAgents([])
    setLocation('project')
    setError(null)
    setResult(null)
    setCreating(false)
    onClose()
  }
  function handleNext() {
    const next = currentStepIndex + 1
    if (next < steps.length) setStep(steps[next]!)
  }
  function handleBack() {
    const prev = currentStepIndex - 1
    if (prev >= 0) setStep(steps[prev]!)
  }
  function toggleAgent(agentId: string) {
    setSelectedAgents((prev) =>
      prev.includes(agentId) ? prev.filter((a) => a !== agentId) : [...prev, agentId]
    )
  }

  async function handleCreate() {
    setCreating(true)
    setError(null)
    try {
      const args = ['--name', name.trim(), '--type', kind]
      if (description.trim()) args.push('--description', description.trim())
      if (location === 'global') args.push('--global')
      const output = await runCLI('init', args, initResultSchema)
      if (output.success && output.data) {
        setResult(output.data)
        onCreated?.(output.data.path)
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
          className="flex max-h-[85vh] w-[520px] max-w-[90%] flex-col gap-4 overflow-y-auto rounded-2xl border border-border bg-card p-6"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center gap-2">
            <div className="flex size-7 items-center justify-center rounded-full border border-green-800 bg-green-950 text-green-500">
              <svg
                width="16"
                height="16"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
              >
                <path d="M3 8.5l3.5 3.5L13 4" />
              </svg>
            </div>
            <h2 className="font-semibold text-foreground text-lg">Skill Created</h2>
          </div>
          <div className="flex flex-col gap-2 rounded-lg border border-border bg-muted p-4">
            <DetailRow label="Name" value={result.name} />
            <DetailRow label="Type" value={result.type} />
            <DetailRow
              label="Path"
              value={result.path}
              valueStyle={{ fontSize: '0.75rem', color: 'var(--color-muted-foreground)' }}
            />
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleClose}
              className="cursor-pointer rounded-lg border-none bg-primary px-4 py-2 font-[inherit] font-medium text-[0.825rem] text-primary-foreground transition-colors hover:bg-primary/90"
            >
              Open in Editor
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
        className="flex max-h-[85vh] w-[520px] max-w-[90%] flex-col gap-4 overflow-y-auto rounded-2xl border border-border bg-card p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-1 flex items-center justify-center">
          {steps.map((s, i) => (
            <div key={s} className="flex items-center">
              {i > 0 && <div className="h-0.5 w-[30px] bg-border" />}
              <div
                className={cn(
                  'size-2.5 rounded-full transition-colors',
                  i <= currentStepIndex ? 'bg-primary' : 'bg-muted-foreground/30'
                )}
              />
            </div>
          ))}
        </div>

        {step === 'type' && (
          <>
            <h2 className="font-semibold text-foreground text-lg">Choose Type</h2>
            <p className="text-[0.825rem] text-muted-foreground">
              What kind of skill do you want to create?
            </p>
            <div className="flex flex-col gap-1.5">
              {SKILL_KINDS.map((k) => (
                <button
                  key={k.value}
                  onClick={() => setKind(k.value)}
                  className={cn(
                    'flex w-full cursor-pointer flex-col gap-0.5 rounded-lg border p-3 text-left font-[inherit] transition-all',
                    kind === k.value
                      ? 'border-primary bg-accent'
                      : 'border-border bg-card hover:border-foreground/20 hover:bg-muted'
                  )}
                >
                  <span
                    className={cn(
                      'font-medium text-sm',
                      kind === k.value ? 'text-foreground' : 'text-foreground'
                    )}
                  >
                    {k.label}
                  </span>
                  <span className="text-muted-foreground text-xs leading-tight">
                    {k.description}
                  </span>
                </button>
              ))}
            </div>
          </>
        )}
        {step === 'details' && (
          <>
            <h2 className="font-semibold text-foreground text-lg">Skill Details</h2>
            <div className="flex flex-col gap-1.5">
              <label className="font-medium text-muted-foreground text-xs">Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="my-skill"
                autoFocus
                className="w-full rounded-lg border border-border bg-card px-3 py-2.5 font-[inherit] text-foreground text-sm outline-none"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="flex items-center gap-1.5 font-medium text-muted-foreground text-xs">
                Description{' '}
                <span className="font-normal text-[0.7rem] text-muted-foreground">optional</span>
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What does this skill do?"
                rows={3}
                className="w-full resize-y rounded-lg border border-border bg-card px-3 py-2.5 font-[inherit] text-foreground text-sm outline-none"
              />
            </div>
          </>
        )}
        {step === 'agents' && (
          <>
            <h2 className="font-semibold text-foreground text-lg">Target Agents</h2>
            <p className="text-[0.825rem] text-muted-foreground">
              Which agents should this skill be available to?
            </p>
            {agents.length === 0 ? (
              <div className="rounded-lg border border-border bg-muted p-4 text-center text-[0.825rem] text-muted-foreground">
                No agents detected. The skill will be available to all agents.
              </div>
            ) : (
              <div className="flex flex-col gap-1.5">
                {agents.map((agent) => {
                  const isSelected = selectedAgents.includes(agent.id)
                  return (
                    <button
                      key={agent.id}
                      onClick={() => toggleAgent(agent.id)}
                      className={cn(
                        'flex w-full cursor-pointer items-center gap-2 rounded-lg border p-2.5 text-left font-[inherit]',
                        isSelected ? 'border-primary bg-accent' : 'border-border bg-card'
                      )}
                    >
                      <div className="flex size-[18px] shrink-0 items-center justify-center rounded border border-muted-foreground/40">
                        {isSelected && (
                          <svg width="10" height="10" viewBox="0 0 10 10">
                            <path
                              d="M2 5l2.5 2.5L8 3"
                              stroke="currentColor"
                              strokeWidth="1.5"
                              fill="none"
                              className="text-primary"
                            />
                          </svg>
                        )}
                      </div>
                      <span
                        className={cn(
                          'text-[0.85rem]',
                          isSelected ? 'text-foreground' : 'text-foreground'
                        )}
                      >
                        {agent.name}
                      </span>
                    </button>
                  )
                })}
              </div>
            )}
          </>
        )}
        {step === 'location' && (
          <>
            <h2 className="font-semibold text-foreground text-lg">Location</h2>
            <p className="text-[0.825rem] text-muted-foreground">
              Where should the skill be created?
            </p>
            <div className="flex flex-col gap-1.5">
              {(['project', 'global'] as const).map((loc) => (
                <button
                  key={loc}
                  onClick={() => setLocation(loc)}
                  className={cn(
                    'flex w-full cursor-pointer flex-col gap-0.5 rounded-lg border p-3 text-left font-[inherit] transition-all',
                    location === loc ? 'border-primary bg-accent' : 'border-border bg-card'
                  )}
                >
                  <span
                    className={cn(
                      'font-medium text-sm',
                      location === loc ? 'text-foreground' : 'text-foreground'
                    )}
                  >
                    {loc === 'project' ? 'Current Project' : 'Global'}
                  </span>
                  <span className="text-muted-foreground text-xs leading-tight">
                    {loc === 'project'
                      ? 'Create in the current project directory'
                      : 'Create in ~/.agentver/skills for use across all projects'}
                  </span>
                </button>
              ))}
            </div>
            {error && (
              <div className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2.5 text-[0.825rem] text-destructive">
                {error}
              </div>
            )}
          </>
        )}

        <div className="flex gap-2">
          {currentStepIndex > 0 && (
            <button
              onClick={handleBack}
              className="cursor-pointer rounded-lg border border-border bg-muted px-4 py-2 font-[inherit] font-medium text-[0.825rem] text-foreground transition-colors hover:bg-accent"
            >
              Back
            </button>
          )}
          <button
            onClick={handleClose}
            className="mr-auto cursor-pointer rounded-lg border border-border bg-muted px-4 py-2 font-[inherit] font-medium text-[0.825rem] text-foreground transition-colors hover:bg-accent"
          >
            Cancel
          </button>
          {step === 'location' ? (
            <button
              onClick={handleCreate}
              disabled={creating || !name.trim()}
              className={cn(
                'cursor-pointer rounded-lg border-none px-4 py-2 font-[inherit] font-medium text-[0.825rem] text-primary-foreground transition-colors',
                creating || !name.trim()
                  ? 'cursor-not-allowed bg-primary/50 opacity-50'
                  : 'bg-primary hover:bg-primary/90'
              )}
            >
              {creating ? 'Creating...' : 'Create'}
            </button>
          ) : (
            <button
              onClick={handleNext}
              disabled={step === 'details' && !name.trim()}
              className={cn(
                'cursor-pointer rounded-lg border-none px-4 py-2 font-[inherit] font-medium text-[0.825rem] text-primary-foreground transition-colors',
                step === 'details' && !name.trim()
                  ? 'bg-primary/50 opacity-50'
                  : 'bg-primary hover:bg-primary/90'
              )}
            >
              Next
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
