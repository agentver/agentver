'use client'

import { Skeleton } from '@agentver/ui/components/skeleton'
import { cn } from '@agentver/ui-utils'
import {
  ArrowDown,
  ArrowUp,
  BarChart3,
  Download,
  Minus,
  Monitor,
  Package,
  Star,
  Users,
} from 'lucide-react'
import { useState } from 'react'
import { BarChart } from '@/components/charts/bar-chart'
import { DonutChart } from '@/components/charts/donut-chart'
import { LineChart } from '@/components/charts/line-chart'
import { Sparkline } from '@/components/charts/sparkline'
import { trpc } from '@/trpc/client'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PERIODS = [
  { value: '7d' as const, label: '7 days' },
  { value: '30d' as const, label: '30 days' },
  { value: '90d' as const, label: '90 days' },
]

const AGENT_COLOURS = [
  'oklch(0.65 0.15 250)',
  'oklch(0.60 0.15 150)',
  'oklch(0.65 0.15 50)',
  'oklch(0.60 0.15 330)',
  'oklch(0.65 0.12 200)',
  'oklch(0.55 0.10 100)',
  'oklch(0.60 0.12 280)',
]

const VERSION_COLOURS = [
  'oklch(0.65 0.15 250)',
  'oklch(0.60 0.15 150)',
  'oklch(0.65 0.15 50)',
  'oklch(0.60 0.15 330)',
  'oklch(0.55 0.12 200)',
  'oklch(0.50 0.10 100)',
]

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type Period = '7d' | '30d' | '90d'

function TrendIndicator({ value }: { value: number }) {
  if (value > 0) {
    return (
      <span className="flex items-center gap-0.5 text-emerald-600 text-xs dark:text-emerald-400">
        <ArrowUp className="size-3" />+{value}
      </span>
    )
  }
  if (value < 0) {
    return (
      <span className="flex items-center gap-0.5 text-red-600 text-xs dark:text-red-400">
        <ArrowDown className="size-3" />
        {value}
      </span>
    )
  }
  return (
    <span className="flex items-center gap-0.5 text-muted-foreground text-xs">
      <Minus className="size-3" />0
    </span>
  )
}

function MetricCard({
  title,
  value,
  trend,
  icon: Icon,
  colour,
  isLoading,
}: {
  title: string
  value: number
  trend: number
  icon: typeof Package
  colour: string
  isLoading: boolean
}) {
  if (isLoading) {
    return (
      <div className="rounded-2xl border border-border bg-card p-6">
        <div className="flex items-start justify-between">
          <div className="space-y-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-8 w-16" />
          </div>
          <Skeleton className="size-10 rounded-2xl" />
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-2xl border border-border bg-card p-6">
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <p className="text-muted-foreground text-sm">{title}</p>
          <div className="flex items-baseline gap-2">
            <p className="font-display font-semibold text-3xl tracking-tight">
              {value.toLocaleString('en-GB')}
            </p>
            <TrendIndicator value={trend} />
          </div>
        </div>
        <div
          className="flex size-10 items-center justify-center rounded-2xl"
          style={{
            backgroundColor: `color-mix(in oklch, ${colour} 10%, transparent)`,
            color: colour,
          }}
        >
          <Icon className="size-5" />
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Skeleton loaders
// ---------------------------------------------------------------------------

function ChartSkeleton({ height = 280 }: { height?: number }) {
  return (
    <div className="rounded-2xl border border-border bg-card">
      <div className="border-border/60 border-b px-6 py-4">
        <Skeleton className="h-5 w-40" />
      </div>
      <div className="p-6">
        <Skeleton className="w-full" style={{ height }} />
      </div>
    </div>
  )
}

function TableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="rounded-2xl border border-border bg-card">
      <div className="border-border/60 border-b px-6 py-4">
        <Skeleton className="h-5 w-32" />
      </div>
      <div className="p-4">
        <div className="space-y-3">
          {Array.from({ length: rows }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Export button
// ---------------------------------------------------------------------------

function ExportButton({ orgSlug }: { orgSlug: string }) {
  const [isExporting, setIsExporting] = useState(false)

  const handleExport = async () => {
    setIsExporting(true)
    try {
      const today = new Date().toISOString().slice(0, 10)
      const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10)
      const url = `/api/v1/audit/export?orgSlug=${encodeURIComponent(orgSlug)}&from=${ninetyDaysAgo}&to=${today}&format=csv`

      const response = await fetch(url)
      if (!response.ok) {
        return
      }

      const blob = await response.blob()
      const downloadUrl = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = downloadUrl
      link.download = `audit-${orgSlug}-${ninetyDaysAgo}-to-${today}.csv`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(downloadUrl)
    } finally {
      setIsExporting(false)
    }
  }

  return (
    <button
      type="button"
      onClick={handleExport}
      disabled={isExporting}
      className={cn(
        'flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm transition-colors',
        'hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-50'
      )}
    >
      <Download className="size-4" />
      {isExporting ? 'Exporting...' : 'Export Logs'}
    </button>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function AnalyticsPage() {
  const [period, setPeriod] = useState<Period>('30d')
  const [selectedSkill, setSelectedSkill] = useState<string | null>(null)

  const { data: orgs, isLoading: orgsLoading } = trpc.organisations.list.useQuery()
  const orgSlug = orgs?.[0]?.slug

  const { data: overview, isLoading: overviewLoading } = trpc.analytics.overview.useQuery(
    { orgSlug: orgSlug!, period },
    { enabled: !!orgSlug }
  )

  const { data: skillAdoption, isLoading: adoptionLoading } = trpc.analytics.skillAdoption.useQuery(
    { orgSlug: orgSlug!, limit: 10 },
    { enabled: !!orgSlug }
  )

  const { data: agentDistribution, isLoading: agentsLoading } =
    trpc.analytics.agentDistribution.useQuery({ orgSlug: orgSlug! }, { enabled: !!orgSlug })

  const { data: memberActivity, isLoading: membersLoading } =
    trpc.analytics.memberActivity.useQuery({ orgSlug: orgSlug!, period }, { enabled: !!orgSlug })

  const { data: versionData, isLoading: versionLoading } = trpc.analytics.versionAdoption.useQuery(
    { orgSlug: orgSlug!, skillName: selectedSkill! },
    { enabled: !!orgSlug && !!selectedSkill }
  )

  if (orgsLoading) {
    return (
      <div className="space-y-8">
        <div>
          <Skeleton className="h-9 w-48" />
          <Skeleton className="mt-2 h-5 w-72" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28 w-full rounded-2xl" />
          ))}
        </div>
      </div>
    )
  }

  if (!orgSlug) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <div className="flex size-12 items-center justify-center rounded-2xl bg-primary-light text-primary">
          <BarChart3 className="size-5" />
        </div>
        <h2 className="mt-4 font-display font-semibold text-lg">No Organisation</h2>
        <p className="mt-1 text-muted-foreground text-sm">
          Join or create an organisation to view analytics.
        </p>
      </div>
    )
  }

  const org = orgs?.find((o) => o.slug === orgSlug)

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="font-display font-semibold text-3xl tracking-tight">Analytics</h1>
          <p className="mt-1.5 text-muted-foreground leading-relaxed">
            Organisation insights for{' '}
            <span className="font-medium text-foreground">{org?.name ?? orgSlug}</span>
          </p>
        </div>
        <div className="flex items-center gap-3">
          <ExportButton orgSlug={orgSlug} />
          <div className="flex items-center rounded-lg border border-border bg-muted/30">
            {PERIODS.map((p) => (
              <button
                key={p.value}
                type="button"
                onClick={() => setPeriod(p.value)}
                className={cn(
                  'rounded-md px-3 py-1.5 text-sm transition-all',
                  period === p.value
                    ? 'bg-background font-medium text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Row 1: Key Metrics */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          title="Total Skills"
          value={overview?.totalSkills ?? 0}
          trend={overview?.skillsTrend ?? 0}
          icon={Package}
          colour="oklch(0.44 0.12 165)"
          isLoading={overviewLoading}
        />
        <MetricCard
          title="Total Installs"
          value={overview?.totalInstalls ?? 0}
          trend={overview?.installsTrend ?? 0}
          icon={Monitor}
          colour="oklch(0.52 0.12 45)"
          isLoading={overviewLoading}
        />
        <MetricCard
          title="Total Stars"
          value={overview?.totalStars ?? 0}
          trend={overview?.starsTrend ?? 0}
          icon={Star}
          colour="oklch(0.55 0.15 50)"
          isLoading={overviewLoading}
        />
        <MetricCard
          title="Active Users"
          value={overview?.activeUsers ?? 0}
          trend={0}
          icon={Users}
          colour="oklch(0.45 0.10 265)"
          isLoading={overviewLoading}
        />
      </div>

      {/* Row 2: Charts */}
      <div className="grid gap-6 lg:grid-cols-2">
        {overviewLoading ? (
          <ChartSkeleton />
        ) : (
          <div className="rounded-2xl border border-border bg-card">
            <div className="border-border/60 border-b px-6 py-4">
              <h2 className="font-display font-semibold text-base tracking-tight">
                Installs Over Time
              </h2>
            </div>
            <div className="p-4">
              <LineChart
                data={overview?.installsOverTime ?? []}
                colour="oklch(0.52 0.12 45)"
                ariaLabel="Installs over time chart"
              />
            </div>
          </div>
        )}

        {agentsLoading ? (
          <ChartSkeleton height={200} />
        ) : (
          <div className="rounded-2xl border border-border bg-card">
            <div className="border-border/60 border-b px-6 py-4">
              <h2 className="font-display font-semibold text-base tracking-tight">
                Agent Distribution
              </h2>
            </div>
            <div className="p-4">
              {agentDistribution && agentDistribution.length > 0 ? (
                <BarChart
                  data={agentDistribution.map((a, i) => ({
                    label: a.agent,
                    value: a.count,
                    colour: AGENT_COLOURS[i % AGENT_COLOURS.length],
                  }))}
                  ariaLabel="Agent distribution chart"
                />
              ) : (
                <div className="flex items-center justify-center py-12 text-muted-foreground text-sm">
                  No agent data available yet
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Row 3: Tables */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Top Skills Table */}
        {adoptionLoading ? (
          <TableSkeleton />
        ) : (
          <div className="rounded-2xl border border-border bg-card">
            <div className="border-border/60 border-b px-6 py-4">
              <h2 className="font-display font-semibold text-base tracking-tight">Top Skills</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-border/60 border-b text-muted-foreground">
                    <th className="px-6 py-3 text-left font-medium">Skill</th>
                    <th className="px-4 py-3 text-right font-medium">Installs</th>
                    <th className="px-4 py-3 text-right font-medium">Stars</th>
                    <th className="px-4 py-3 text-right font-medium">Modified</th>
                    <th className="px-4 py-3 text-right font-medium">Trend</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {skillAdoption && skillAdoption.length > 0 ? (
                    skillAdoption.map((skill) => (
                      <tr
                        key={skill.id}
                        className={cn(
                          'cursor-pointer transition-colors hover:bg-muted/50',
                          selectedSkill === skill.name && 'bg-muted/30'
                        )}
                        onClick={() =>
                          setSelectedSkill(selectedSkill === skill.name ? null : skill.name)
                        }
                      >
                        <td className="px-6 py-3 font-medium">{skill.name}</td>
                        <td className="px-4 py-3 text-right">
                          {skill.installCount.toLocaleString('en-GB')}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {skill.starCount.toLocaleString('en-GB')}
                        </td>
                        <td className="px-4 py-3 text-right">{skill.modificationRate}%</td>
                        <td className="px-4 py-3 text-right">
                          <Sparkline
                            data={skill.trend}
                            ariaLabel={`Install trend for ${skill.name}`}
                          />
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={5} className="px-6 py-8 text-center text-muted-foreground">
                        No skills registered yet
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Member Activity Table */}
        {membersLoading ? (
          <TableSkeleton />
        ) : (
          <div className="rounded-2xl border border-border bg-card">
            <div className="border-border/60 border-b px-6 py-4">
              <h2 className="font-display font-semibold text-base tracking-tight">
                Member Activity
              </h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-border/60 border-b text-muted-foreground">
                    <th className="px-6 py-3 text-left font-medium">Member</th>
                    <th className="px-4 py-3 text-right font-medium">Published</th>
                    <th className="px-4 py-3 text-right font-medium">Suggestions</th>
                    <th className="px-4 py-3 text-right font-medium">Installs</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {memberActivity && memberActivity.length > 0 ? (
                    memberActivity.map((member) => (
                      <tr key={member.userId} className="transition-colors hover:bg-muted/50">
                        <td className="px-6 py-3">
                          <div className="flex items-center gap-2">
                            {member.image ? (
                              <img src={member.image} alt="" className="size-6 rounded-full" />
                            ) : (
                              <div className="flex size-6 items-center justify-center rounded-full bg-muted font-medium text-[10px]">
                                {member.name.charAt(0).toUpperCase()}
                              </div>
                            )}
                            <span className="font-medium">{member.name}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right">{member.skillsPublished}</td>
                        <td className="px-4 py-3 text-right">
                          {member.suggestionsCreated}
                          {member.suggestionsMerged > 0 && (
                            <span className="ml-1 text-emerald-600 text-xs dark:text-emerald-400">
                              ({member.suggestionsMerged} merged)
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">{member.installs}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={4} className="px-6 py-8 text-center text-muted-foreground">
                        No member activity in this period
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Row 4: Version Adoption (conditional) */}
      {selectedSkill && (
        <div className="rounded-2xl border border-border bg-card">
          <div className="border-border/60 border-b px-6 py-4">
            <div className="flex items-center justify-between">
              <h2 className="font-display font-semibold text-base tracking-tight">
                Version Uptake &mdash;{' '}
                <span className="text-muted-foreground">{selectedSkill}</span>
              </h2>
              <button
                type="button"
                onClick={() => setSelectedSkill(null)}
                className="text-muted-foreground text-sm hover:text-foreground"
              >
                Clear
              </button>
            </div>
          </div>
          <div className="p-6">
            {versionLoading ? (
              <div className="flex items-center gap-8">
                <Skeleton className="size-[200px] rounded-full" />
                <div className="space-y-3">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <Skeleton key={i} className="h-5 w-40" />
                  ))}
                </div>
              </div>
            ) : versionData && versionData.versions.length > 0 ? (
              <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
                <DonutChart
                  data={versionData.versions.map((v, i) => ({
                    label: `v${v.version}${v.isLatest ? ' (latest)' : ''}`,
                    value: v.installs,
                    colour: VERSION_COLOURS[i % VERSION_COLOURS.length]!,
                  }))}
                  centreValue={`${versionData.latestAdoptionRate}%`}
                  centreLabel="on latest"
                  ariaLabel={`Version uptake for ${selectedSkill}`}
                />
                <div className="flex-1">
                  <h3 className="font-medium text-sm">Version Breakdown</h3>
                  <div className="mt-3 space-y-2">
                    {versionData.versions.map((v) => (
                      <div key={v.version} className="flex items-center justify-between text-sm">
                        <span className={cn(v.isLatest && 'font-medium')}>
                          v{v.version}
                          {v.isLatest && (
                            <span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-emerald-800 text-xs dark:bg-emerald-900/30 dark:text-emerald-300">
                              latest
                            </span>
                          )}
                        </span>
                        <span className="text-muted-foreground">
                          {v.installs} installs ({v.percentage}%)
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-center py-8 text-muted-foreground text-sm">
                No version data available for this skill
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
