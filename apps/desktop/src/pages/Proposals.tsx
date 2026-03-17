import type { DiffResult, ProposalsResult } from '@agentver/shared'
import { cn } from '@agentver/ui-utils'
import { useState } from 'react'
import { DiffViewer } from '../components/DiffViewer'
import { useInstalledSkills } from '../hooks/useInstalledSkills'
import { useProposals } from '../hooks/useProposals'
import { formatRelativeTime } from '../lib/format'

type Proposal = ProposalsResult['proposals'][number]
type StatusFilter = 'all' | 'open' | 'merged' | 'rejected'
const STATUS_COLOURS: Record<string, string> = {
  open: '#3b82f6',
  'in review': '#8b5cf6',
  approved: '#22c55e',
  merged: '#22c55e',
  rejected: '#ef4444',
  closed: '#888',
}
function getStatusColour(status: string): string {
  return STATUS_COLOURS[status.toLowerCase()] ?? '#888'
}

function StatusBadge({ status }: { status: string }) {
  const colour = getStatusColour(status)
  return (
    <span
      className="inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 font-medium text-[0.7rem] capitalize"
      style={{ background: `${colour}18`, color: colour, borderColor: `${colour}33` }}
    >
      {status}
    </span>
  )
}

function filterProposals(proposals: Proposal[], filter: StatusFilter): Proposal[] {
  if (filter === 'all') return proposals
  return proposals.filter((p) => p.status.toLowerCase() === filter)
}
function RefreshIcon() {
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
      <path d="M1.5 8a6.5 6.5 0 0111.48-4.16" />
      <path d="M14.5 8a6.5 6.5 0 01-11.48 4.16" />
      <path d="M13 1v3.5h-3.5" />
      <path d="M3 15v-3.5h3.5" />
    </svg>
  )
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

function CreateProposalDialog({
  open,
  modifiedSkills,
  onSubmit,
  onClose,
  fetchDiff,
}: {
  open: boolean
  modifiedSkills: string[]
  onSubmit: (name: string, title: string) => Promise<void>
  onClose: () => void
  fetchDiff: (name: string) => Promise<{ success: boolean; data?: DiffResult | null }>
}) {
  const [selectedSkill, setSelectedSkill] = useState('')
  const [title, setTitle] = useState('')
  const [previewHunks, setPreviewHunks] = useState<DiffResult['hunks'] | null>(null)
  const [loadingPreview, setLoadingPreview] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (!open) return null
  async function handlePreviewDiff() {
    if (!selectedSkill) return
    setLoadingPreview(true)
    setError(null)
    const result = await fetchDiff(selectedSkill)
    if (result.success && result.data) setPreviewHunks(result.data.hunks)
    else setError('Failed to load diff preview')
    setLoadingPreview(false)
  }
  async function handleSubmit() {
    if (!selectedSkill || !title.trim()) return
    setSubmitting(true)
    setError(null)
    try {
      await onSubmit(selectedSkill, title.trim())
      setSelectedSkill('')
      setTitle('')
      setPreviewHunks(null)
      onClose()
    } catch {
      setError('Failed to create proposal')
    }
    setSubmitting(false)
  }

  return (
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        className="flex max-h-[80vh] w-[90%] max-w-[600px] flex-col gap-4 overflow-y-auto rounded-2xl border border-border bg-card p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-foreground text-lg tracking-tight">Create Proposal</h2>
          <button
            onClick={onClose}
            className="flex cursor-pointer items-center justify-center rounded border-none bg-transparent p-1 text-muted-foreground"
          >
            <CloseIcon />
          </button>
        </div>
        {modifiedSkills.length === 0 ? (
          <p className="text-muted-foreground text-sm leading-relaxed">
            No modified skills found. Modify a skill locally first.
          </p>
        ) : (
          <>
            <div className="flex flex-col gap-1.5">
              <label className="font-medium text-muted-foreground text-xs uppercase tracking-wider">
                Skill
              </label>
              <select
                value={selectedSkill}
                onChange={(e) => {
                  setSelectedSkill(e.target.value)
                  setPreviewHunks(null)
                }}
                className="cursor-pointer rounded-lg border border-border bg-background px-3 py-2 font-[inherit] text-foreground text-sm outline-none"
              >
                <option value="">Select a modified skill...</option>
                {modifiedSkills.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="font-medium text-muted-foreground text-xs uppercase tracking-wider">
                Title
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Describe your proposed changes..."
                className="rounded-lg border border-border bg-background px-3 py-2 font-[inherit] text-foreground text-sm outline-none"
              />
            </div>
            {selectedSkill && (
              <div className="flex flex-col gap-1.5">
                <button
                  onClick={handlePreviewDiff}
                  disabled={loadingPreview}
                  className={cn(
                    'inline-flex cursor-pointer items-center self-start rounded-lg border border-border px-3 py-1.5 font-[inherit] font-medium text-foreground text-xs transition-colors',
                    loadingPreview ? 'cursor-not-allowed opacity-50' : 'bg-muted hover:bg-accent'
                  )}
                >
                  {loadingPreview ? 'Loading diff...' : 'Preview diff'}
                </button>
              </div>
            )}
            {previewHunks && (
              <div className="max-h-[300px] overflow-y-auto rounded-lg border border-border p-2">
                <DiffViewer hunks={previewHunks} />
              </div>
            )}
            {error && <p className="text-[0.825rem] text-destructive">{error}</p>}
            <div className="mt-2 flex justify-end gap-2">
              <button
                onClick={onClose}
                className="cursor-pointer rounded-lg border border-border bg-muted px-4 py-2 font-[inherit] font-medium text-[0.825rem] text-foreground transition-colors hover:bg-accent"
              >
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                disabled={!selectedSkill || !title.trim() || submitting}
                className={cn(
                  'cursor-pointer rounded-lg border-none px-4 py-2 font-[inherit] font-medium text-[0.825rem] text-primary-foreground transition-colors',
                  !selectedSkill || !title.trim() || submitting
                    ? 'cursor-not-allowed bg-primary/50 opacity-50'
                    : 'bg-primary hover:bg-primary/90'
                )}
              >
                {submitting ? 'Creating...' : 'Create Proposal'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function ProposalDetail({
  proposal,
  diff,
  diffLoading,
  onClose,
}: {
  proposal: Proposal
  diff: DiffResult | null
  diffLoading: boolean
  onClose: () => void
}) {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-2">
          <h2 className="font-[family-name:var(--font-display)] font-semibold text-foreground text-xl tracking-tight">
            {proposal.title}
          </h2>
          <div className="flex flex-wrap items-center gap-3">
            <StatusBadge status={proposal.status} />
            <span className="text-muted-foreground text-xs">
              {proposal.packageName} &middot; {proposal.author} &middot;{' '}
              {formatRelativeTime(proposal.createdAt)}
            </span>
          </div>
        </div>
        <button
          onClick={onClose}
          className="flex shrink-0 cursor-pointer items-center justify-center rounded-lg border border-border bg-transparent p-1.5 text-muted-foreground transition-colors hover:text-foreground"
        >
          <CloseIcon />
        </button>
      </div>
      <div className="flex flex-col">
        {diffLoading ? (
          <div className="flex items-center justify-center p-12">
            <span className="text-muted-foreground text-sm">Loading diff...</span>
          </div>
        ) : diff ? (
          <DiffViewer hunks={diff.hunks} />
        ) : (
          <div className="flex items-center justify-center p-12">
            <span className="text-muted-foreground text-sm">No diff available</span>
          </div>
        )}
      </div>
    </div>
  )
}

export function Proposals() {
  const { proposals, loading, error, fetchProposals, createProposal, fetchDiff } = useProposals()
  const { skills } = useInstalledSkills()
  const [activeFilter, setActiveFilter] = useState<StatusFilter>('all')
  const [selectedProposal, setSelectedProposal] = useState<Proposal | null>(null)
  const [selectedDiff, setSelectedDiff] = useState<DiffResult | null>(null)
  const [diffLoading, setDiffLoading] = useState(false)
  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const [hoveredRow, setHoveredRow] = useState<string | null>(null)
  const modifiedSkills = skills.filter((s) => s.modified).map((s) => s.name)
  const filteredProposals = filterProposals(proposals, activeFilter)
  const filters: { id: StatusFilter; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'open', label: 'Open' },
    { id: 'merged', label: 'Merged' },
    { id: 'rejected', label: 'Rejected' },
  ]

  async function handleSelectProposal(proposal: Proposal) {
    setSelectedProposal(proposal)
    setDiffLoading(true)
    setSelectedDiff(null)
    const result = await fetchDiff(proposal.packageName)
    if (result.success && result.data) setSelectedDiff(result.data)
    setDiffLoading(false)
  }
  async function handleCreateProposal(name: string, title: string) {
    const result = await createProposal(name, title)
    if (!result.success) throw new Error(result.error?.message ?? 'Failed to create proposal')
  }

  if (selectedProposal)
    return (
      <div className="mx-auto max-w-[1100px] px-10 py-8">
        <ProposalDetail
          proposal={selectedProposal}
          diff={selectedDiff}
          diffLoading={diffLoading}
          onClose={() => {
            setSelectedProposal(null)
            setSelectedDiff(null)
          }}
        />
      </div>
    )

  return (
    <div className="mx-auto max-w-[1100px] px-10 py-8">
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="mb-1 font-[family-name:var(--font-display)] font-semibold text-2xl text-foreground tracking-tight">
            Proposals
          </h1>
          <p className="text-muted-foreground text-sm">Proposed changes to shared skills</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => fetchProposals()}
            disabled={loading}
            className={cn(
              'flex shrink-0 cursor-pointer items-center gap-2 rounded-lg border border-border px-4 py-2 font-[inherit] font-medium text-[0.825rem] text-foreground transition-colors',
              loading ? 'cursor-not-allowed opacity-50' : 'bg-muted hover:bg-accent'
            )}
          >
            <span
              className={cn('flex items-center', loading && 'animate-[spin_1s_linear_infinite]')}
            >
              <RefreshIcon />
            </span>
            <span>Refresh</span>
          </button>
          <button
            onClick={() => setShowCreateDialog(true)}
            className="flex shrink-0 cursor-pointer items-center gap-2 rounded-lg border-none bg-primary px-4 py-2 font-[inherit] font-medium text-[0.825rem] text-primary-foreground shadow-lg shadow-primary/20 transition-colors hover:bg-primary/90"
          >
            <span>+ Create Proposal</span>
          </button>
        </div>
      </div>
      {error && (
        <div className="mb-6 rounded-xl border border-destructive/20 bg-destructive/5 px-4 py-3 text-[0.85rem] text-destructive">
          {error}
        </div>
      )}
      <div className="mb-4 flex gap-1 border-border border-b">
        {filters.map((f) => (
          <button
            key={f.id}
            onClick={() => setActiveFilter(f.id)}
            className={cn(
              'cursor-pointer border-b-2 border-none bg-none px-4 py-2 font-[inherit] font-medium text-[0.825rem] transition-colors',
              activeFilter === f.id
                ? 'border-b-primary text-foreground'
                : 'border-transparent text-muted-foreground'
            )}
          >
            {f.label}
          </button>
        ))}
      </div>
      {loading && proposals.length === 0 ? (
        <div className="flex flex-col gap-2 py-4">
          <div className="h-11 animate-[pulse_1.5s_ease-in-out_infinite] rounded-md bg-muted" />
          <div className="h-11 animate-[pulse_1.5s_ease-in-out_infinite] rounded-md bg-muted" />
          <div className="h-11 animate-[pulse_1.5s_ease-in-out_infinite] rounded-md bg-muted" />
        </div>
      ) : filteredProposals.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 px-8 py-16">
          <div className="mb-2 opacity-60">
            <svg
              width="48"
              height="48"
              viewBox="0 0 48 48"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-muted-foreground"
            >
              <circle cx="16" cy="12" r="4" />
              <circle cx="16" cy="36" r="4" />
              <circle cx="32" cy="24" r="4" />
              <path d="M16 16v16" />
              <path d="M16 16c0 8 16 0 16 8" />
            </svg>
          </div>
          <p className="font-semibold text-foreground text-lg">No proposals yet</p>
          <p className="text-center text-muted-foreground text-sm">
            {activeFilter !== 'all'
              ? `No ${activeFilter} proposals found. Try a different filter.`
              : 'Create a proposal to suggest changes to a shared skill.'}
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border">
          <div className="flex items-center border-border border-b bg-card px-4 py-2.5">
            <span className="flex-[2] font-semibold text-[0.7rem] text-muted-foreground uppercase tracking-wider">
              Title
            </span>
            <span className="flex-1 font-semibold text-[0.7rem] text-muted-foreground uppercase tracking-wider">
              Package
            </span>
            <span className="w-[90px] font-semibold text-[0.7rem] text-muted-foreground uppercase tracking-wider">
              Status
            </span>
            <span className="flex-1 font-semibold text-[0.7rem] text-muted-foreground uppercase tracking-wider">
              Author
            </span>
            <span className="w-[120px] text-right font-semibold text-[0.7rem] text-muted-foreground uppercase tracking-wider">
              Created
            </span>
          </div>
          {filteredProposals.map((proposal) => (
            <div
              key={proposal.id}
              onClick={() => handleSelectProposal(proposal)}
              onMouseEnter={() => setHoveredRow(proposal.id)}
              onMouseLeave={() => setHoveredRow(null)}
              className={cn(
                'flex cursor-pointer items-center border-border/50 border-b px-4 py-3 transition-colors',
                hoveredRow === proposal.id && 'bg-muted'
              )}
            >
              <span className="flex min-w-0 flex-[2] items-center">
                <span className="truncate font-medium text-foreground text-sm">
                  {proposal.title}
                </span>
              </span>
              <span className="flex min-w-0 flex-1 items-center">
                <span className="truncate font-mono text-muted-foreground text-xs">
                  {proposal.packageName}
                </span>
              </span>
              <span className="flex w-[90px] items-center">
                <StatusBadge status={proposal.status} />
              </span>
              <span className="flex min-w-0 flex-1 items-center">
                <span className="truncate text-muted-foreground text-xs">{proposal.author}</span>
              </span>
              <span className="flex w-[120px] items-center justify-end">
                <span className="whitespace-nowrap text-muted-foreground text-xs">
                  {formatRelativeTime(proposal.createdAt)}
                </span>
              </span>
            </div>
          ))}
        </div>
      )}
      <CreateProposalDialog
        open={showCreateDialog}
        modifiedSkills={modifiedSkills}
        onSubmit={handleCreateProposal}
        onClose={() => setShowCreateDialog(false)}
        fetchDiff={fetchDiff}
      />
    </div>
  )
}
