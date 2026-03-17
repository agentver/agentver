'use client'

import { Button } from '@agentver/ui/components/button'
import { cn } from '@agentver/ui-utils'
import { Building2, Check, GitBranch, Github, Package, Terminal, X } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { PackageManagerTabs } from '@/components/ui/package-manager-tabs'

const DISMISSED_KEY = 'agentver:getting-started-dismissed'

type GettingStartedProgress = {
  hasOrg: boolean
  hasSkillsRepo: boolean
  hasPackage: boolean
  hasApiKey: boolean
  hasConnectedGitHub: boolean
}

type GettingStartedProps = {
  progress: GettingStartedProgress
}

export function GettingStarted({ progress }: GettingStartedProps) {
  const [dismissed, setDismissed] = useState(true)

  useEffect(() => {
    const stored = localStorage.getItem(DISMISSED_KEY)
    setDismissed(stored === 'true')
  }, [])

  const allComplete =
    progress.hasOrg &&
    progress.hasSkillsRepo &&
    progress.hasPackage &&
    progress.hasApiKey &&
    progress.hasConnectedGitHub

  if (dismissed || allComplete) return null

  const completedCount = [
    progress.hasOrg,
    progress.hasSkillsRepo,
    progress.hasPackage,
    progress.hasApiKey,
    progress.hasConnectedGitHub,
  ].filter(Boolean).length

  const handleDismiss = () => {
    localStorage.setItem(DISMISSED_KEY, 'true')
    setDismissed(true)
  }

  const steps = [
    {
      key: 'org',
      label: 'Create an organisation',
      description: 'Set up your team or personal workspace to publish packages under',
      done: progress.hasOrg,
      href: '/settings/organisation',
    },
    {
      key: 'repo',
      label: 'Connect a package repository',
      description:
        'A package repository is required to store, version, and manage your skills. Choose built-in storage or connect GitHub.',
      done: progress.hasSkillsRepo,
      href: '/settings/organisation',
    },
    {
      key: 'package',
      label: 'Create your first package',
      description:
        'A skill is a set of instructions that tells AI coding assistants how to work on your project',
      done: progress.hasPackage,
      href: '/skills/new',
    },
    {
      key: 'cli',
      label: 'Install the Agentver command-line tool',
      description: 'Paste one of the commands below into your terminal to get started',
      done: progress.hasApiKey,
      href: undefined,
    },
    {
      key: 'github',
      label: 'Connect a source',
      description: 'Link GitHub or another source to import existing skills and configurations',
      done: progress.hasConnectedGitHub,
      href: '/sources',
    },
  ] as const

  return (
    <div className="relative rounded-2xl border border-border bg-card p-6">
      <div className="flex items-start justify-between">
        <div>
          <h3 className="font-display font-semibold text-lg tracking-tight">Getting started</h3>
          <p className="mt-1 text-muted-foreground text-sm">
            {completedCount} of {steps.length} steps complete
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="size-8 text-muted-foreground"
          onClick={handleDismiss}
        >
          <X className="size-4" />
        </Button>
      </div>

      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary transition-all duration-500"
          style={{ width: `${(completedCount / steps.length) * 100}%` }}
        />
      </div>

      <div className="mt-5 space-y-2">
        {steps.map((step) => {
          const icon =
            step.key === 'org'
              ? Building2
              : step.key === 'repo'
                ? GitBranch
                : step.key === 'package'
                  ? Package
                  : step.key === 'cli'
                    ? Terminal
                    : Github

          const StepIcon = icon

          const content = (
            <div
              className={cn(
                'flex items-center gap-3 rounded-xl px-4 py-3 transition-colors',
                step.done ? 'bg-muted/40 text-muted-foreground' : 'bg-muted/50 hover:bg-muted/80'
              )}
            >
              <div
                className={cn(
                  'flex size-7 shrink-0 items-center justify-center rounded-lg',
                  step.done ? 'bg-primary text-primary-foreground' : 'bg-muted'
                )}
              >
                {step.done ? <Check className="size-3.5" /> : <StepIcon className="size-3.5" />}
              </div>
              <div className="flex-1">
                <span className={cn('font-medium text-sm', step.done && 'line-through')}>
                  {step.label}
                </span>
                {!step.done && step.description && (
                  <p className="mt-0.5 text-muted-foreground text-xs">{step.description}</p>
                )}
              </div>
            </div>
          )

          if (step.key === 'cli') {
            return (
              <div key={step.key} className="space-y-2">
                {content}
                {!step.done && (
                  <div className="ml-10">
                    <PackageManagerTabs packageName="agentver" global />
                  </div>
                )}
              </div>
            )
          }

          if (step.href && !step.done) {
            return (
              <Link key={step.key} href={step.href}>
                {content}
              </Link>
            )
          }

          return <div key={step.key}>{content}</div>
        })}
      </div>
    </div>
  )
}
