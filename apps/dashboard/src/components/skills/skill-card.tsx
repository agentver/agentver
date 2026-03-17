'use client'

import type { SpecComplianceLevel } from '@agentver/shared'
import { cn } from '@agentver/ui-utils'
import {
  Check,
  ExternalLink,
  GitBranch,
  GitFork,
  Monitor,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react'
import Link from 'next/link'
import { VerifiedBadge } from '@/components/verified-badge'
import { AGENT_DISPLAY, type AgentDisplayInfo } from '@/lib/agent-display'
import { PACKAGE_TYPE_DISPLAY } from '@/lib/package-types'

type SkillCardProps = {
  id: string
  slug: string
  name: string
  description?: string | null
  type: string
  tags: string[]
  version: string
  installations: number
  forks?: number
  author?: { name: string | null; image: string | null } | null
  orgSlug: string
  specCompliance?: SpecComplianceLevel | null
  compatibility?: string[]
  selectable?: boolean
  selected?: boolean
  onToggleSelect?: (id: string) => void
  gitUri?: string | null
  gitPath?: string | null
  gitDefaultRef?: string
  gitRef?: string | null
  isVerified?: boolean
}

const COMPLIANCE_STYLES: Record<'compliant' | 'partial', { label: string; className: string }> = {
  compliant: {
    label: 'Spec compliant',
    className: 'bg-emerald-100 text-emerald-800',
  },
  partial: {
    label: 'Partial',
    className: 'bg-amber-100 text-amber-800',
  },
}

function buildGitUrl(
  gitUri: string | null | undefined,
  gitPath: string | null | undefined
): string | null {
  if (!gitUri) return null
  const base = gitUri.startsWith('http') ? gitUri : `https://${gitUri}`
  if (gitPath) return `${base}/tree/HEAD/${gitPath}`
  return base
}

export function SkillCard({
  id,
  name,
  description,
  type,
  tags,
  version,
  installations,
  forks,
  orgSlug,
  specCompliance,
  compatibility,
  selectable,
  selected,
  onToggleSelect,
  gitUri,
  gitPath,
  gitDefaultRef,
  gitRef,
  isVerified,
}: SkillCardProps) {
  const handleCheckboxClick = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    onToggleSelect?.(id)
  }

  const complianceStyle =
    specCompliance && specCompliance !== 'none' ? COMPLIANCE_STYLES[specCompliance] : null

  const gitUrl = buildGitUrl(gitUri, gitPath)
  const displayRef = gitRef ?? gitDefaultRef ?? 'main'

  return (
    <Link href={`/skills/${orgSlug}/${name}`}>
      <div
        className={cn(
          'group rounded-2xl border border-border bg-card p-5 transition-all duration-300 hover:-translate-y-1 hover:shadow-lg hover:shadow-primary/[0.04]',
          selected && 'border-primary/30 ring-2 ring-primary'
        )}
      >
        <div className="flex items-start justify-between">
          <div className="flex items-start gap-2.5">
            {selectable && (
              <button
                type="button"
                onClick={handleCheckboxClick}
                className={cn(
                  'mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md border transition-colors',
                  selected
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border hover:border-muted-foreground/50'
                )}
              >
                {selected && <Check className="size-3" />}
              </button>
            )}
            <div>
              <h3 className="font-display font-semibold tracking-tight">{name}</h3>
              <p className="mt-0.5 flex items-center gap-1 text-muted-foreground text-xs">
                {orgSlug}
                {isVerified && <VerifiedBadge />}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            {type === 'SKILL' && complianceStyle && (
              <span
                className={cn(
                  'inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium text-xs',
                  complianceStyle.className
                )}
              >
                {specCompliance === 'compliant' ? (
                  <ShieldCheck className="size-3" />
                ) : (
                  <ShieldAlert className="size-3" />
                )}
                {complianceStyle.label}
              </span>
            )}
            <span
              className={cn(
                'rounded-full px-2.5 py-0.5 font-medium text-xs',
                PACKAGE_TYPE_DISPLAY[type]?.colour ?? 'bg-secondary text-secondary-foreground'
              )}
            >
              {PACKAGE_TYPE_DISPLAY[type]?.label ?? type.toLowerCase()}
            </span>
          </div>
        </div>

        {description && (
          <p className="mt-3 line-clamp-2 text-muted-foreground text-sm leading-relaxed">
            {description}
          </p>
        )}

        {gitUri && (
          <div className="mt-3 flex items-center gap-2 text-muted-foreground text-xs">
            <GitBranch className="size-3 shrink-0" />
            <span className="truncate font-mono">{gitUri}</span>
            {gitUrl && (
              <ExternalLink
                className="size-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  window.open(gitUrl, '_blank', 'noopener,noreferrer')
                }}
              />
            )}
          </div>
        )}

        {compatibility && compatibility.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1">
            {compatibility.slice(0, 5).map((agent) => {
              const display: AgentDisplayInfo | undefined = AGENT_DISPLAY[agent]
              return (
                <span
                  key={agent}
                  className={cn(
                    'rounded-full px-2 py-0.5 font-medium text-xs',
                    display?.colour ?? 'bg-gray-100 text-gray-700'
                  )}
                >
                  {display?.label ?? agent}
                </span>
              )
            })}
            {compatibility.length > 5 && (
              <span className="px-1 text-muted-foreground text-xs">
                +{compatibility.length - 5}
              </span>
            )}
          </div>
        )}

        {tags.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-1.5">
            {tags.slice(0, 3).map((tag) => (
              <span
                key={tag}
                className="rounded-full border border-border px-2 py-0.5 text-muted-foreground text-xs"
              >
                {tag}
              </span>
            ))}
            {tags.length > 3 && (
              <span className="px-1 text-muted-foreground text-xs">+{tags.length - 3}</span>
            )}
          </div>
        )}

        <div className="mt-4 flex items-center gap-3 text-muted-foreground text-xs">
          <span className="flex items-center gap-1 font-mono">
            <GitBranch className="size-3" /> {displayRef}
          </span>
          <span className="font-mono">v{version}</span>
          <span className="flex items-center gap-1">
            <Monitor className="size-3" /> {installations}
          </span>
          {forks !== undefined && forks > 0 && (
            <span className="flex items-center gap-1">
              <GitFork className="size-3" /> {forks}
            </span>
          )}
        </div>
      </div>
    </Link>
  )
}
