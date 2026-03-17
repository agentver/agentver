'use client'

import { Badge } from '@agentver/ui/components/badge'
import { Skeleton } from '@agentver/ui/components/skeleton'
import { cn } from '@agentver/ui-utils'
import {
  Activity,
  AlertTriangle,
  BookOpen,
  Compass,
  Download,
  GitBranch,
  Lightbulb,
  Monitor,
  Package,
  Plus,
  Users,
} from 'lucide-react'
import Link from 'next/link'
import { ActivityFeed } from '@/components/dashboard/activity-feed'
import { GettingStarted } from '@/components/dashboard/getting-started'
import { StatsCard, TypeBreakdown } from '@/components/dashboard/stats-card'
import { FadeIn } from '@/components/fade-in'
import { useSession } from '@/lib/auth/client'
import { PACKAGE_TYPE_DISPLAY } from '@/lib/package-types'
import { trpc } from '@/trpc/client'

function formatRelativeTime(date: Date): string {
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffSeconds = Math.floor(diffMs / 1000)
  const diffMinutes = Math.floor(diffSeconds / 60)
  const diffHours = Math.floor(diffMinutes / 60)
  const diffDays = Math.floor(diffHours / 24)

  if (diffSeconds < 60) return 'just now'
  if (diffMinutes < 60) return `${diffMinutes}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < 7) return `${diffDays}d ago`
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

function StatsLoading() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="rounded-2xl border border-border bg-card p-6">
          <div className="flex items-start justify-between">
            <div className="space-y-2">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-8 w-16" />
            </div>
            <Skeleton className="size-10 rounded-2xl" />
          </div>
        </div>
      ))}
    </div>
  )
}

function RecentPackagesLoading() {
  return (
    <div className="space-y-1">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 rounded-lg px-3 py-2.5">
          <Skeleton className="size-7 rounded-lg" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3 w-24" />
          </div>
        </div>
      ))}
    </div>
  )
}

function ActivityLoading() {
  return (
    <div className="space-y-1">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex items-start gap-3 rounded-lg px-3 py-2.5">
          <Skeleton className="size-7 rounded-lg" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-3 w-16" />
          </div>
        </div>
      ))}
    </div>
  )
}

function InstallationsLoading() {
  return (
    <div className="space-y-1">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 rounded-lg px-3 py-2.5">
          <Skeleton className="size-7 rounded-lg" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-3 w-32" />
          </div>
        </div>
      ))}
    </div>
  )
}

type QuickAction = {
  label: string
  href: string
  icon: typeof Plus
  primary: boolean
  external: boolean
}

function getQuickActions(hasSkillsRepo: boolean): QuickAction[] {
  if (!hasSkillsRepo) {
    return [
      {
        label: 'Connect Repository',
        href: '/settings/organisation',
        icon: GitBranch,
        primary: true,
        external: false,
      },
      {
        label: 'Create Package',
        href: '/skills/new',
        icon: Plus,
        primary: false,
        external: false,
      },
      {
        label: 'Explore Registry',
        href: '/explore',
        icon: Compass,
        primary: false,
        external: false,
      },
      {
        label: 'View Documentation',
        href: 'https://agentver.com/docs',
        icon: BookOpen,
        primary: false,
        external: true,
      },
    ]
  }

  return [
    {
      label: 'Create Package',
      href: '/skills/new',
      icon: Plus,
      primary: true,
      external: false,
    },
    {
      label: 'Explore Registry',
      href: '/explore',
      icon: Compass,
      primary: false,
      external: false,
    },
    {
      label: 'Import from Source',
      href: '/sources',
      icon: Download,
      primary: false,
      external: false,
    },
    {
      label: 'View Documentation',
      href: 'https://agentver.com/docs',
      icon: BookOpen,
      primary: false,
      external: true,
    },
  ]
}

export default function DashboardPage() {
  const { data: session } = useSession()
  const { data: stats, isLoading: statsLoading } = trpc.dashboard.getStats.useQuery()
  const { data: recentPackages, isLoading: packagesLoading } =
    trpc.dashboard.getRecentPackages.useQuery()
  const { data: recentActivity, isLoading: activityLoading } =
    trpc.dashboard.getRecentActivity.useQuery()
  const { data: recentInstallations, isLoading: installationsLoading } =
    trpc.dashboard.getRecentInstallations.useQuery()
  const { data: progress, isLoading: progressLoading } =
    trpc.dashboard.getGettingStartedProgress.useQuery()

  return (
    <div className="space-y-10">
      {/* Welcome greeting */}
      <FadeIn>
        <div>
          <h1 className="font-display font-semibold text-3xl tracking-tight">
            Welcome back
            {session?.user?.name ? `, ${session.user.name.split(' ')[0]}` : ''}
          </h1>
          <p className="mt-1.5 text-muted-foreground leading-relaxed">
            Here&rsquo;s what&rsquo;s happening across your workspace.
          </p>
        </div>
      </FadeIn>

      {/* Quick actions */}
      <FadeIn delay={50}>
        <div className="flex flex-wrap gap-3">
          {getQuickActions(progress?.hasSkillsRepo ?? true).map((action) => {
            const ActionIcon = action.icon
            const classes = cn(
              'inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium transition-all hover:-translate-y-0.5 hover:shadow-md',
              action.primary
                ? 'bg-primary text-white border-primary shadow-lg shadow-primary/20'
                : 'border-border text-muted-foreground hover:border-primary/30 hover:text-foreground'
            )

            if (action.external) {
              return (
                <a
                  key={action.href}
                  href={action.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={classes}
                >
                  <ActionIcon className="size-4" />
                  {action.label}
                </a>
              )
            }

            return (
              <Link key={action.href} href={action.href} className={classes}>
                <ActionIcon className="size-4" />
                {action.label}
              </Link>
            )
          })}
        </div>
      </FadeIn>

      {/* Stats row */}
      {statsLoading ? (
        <StatsLoading />
      ) : stats ? (
        <>
          <FadeIn delay={100}>
            <div className="grid grid-rows-[1fr] gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Link
                href="/skills"
                className="rounded-2xl transition-shadow duration-200 hover:shadow-md"
              >
                <StatsCard
                  title="Registered Skills"
                  value={stats.totalPackages}
                  icon={Package}
                  colour="oklch(0.44 0.12 165)"
                />
              </Link>
              <Link
                href="/skills"
                className="rounded-2xl transition-shadow duration-200 hover:shadow-md"
              >
                <StatsCard
                  title="Active Installations"
                  value={stats.totalInstallations}
                  icon={Monitor}
                  colour="oklch(0.52 0.12 45)"
                />
              </Link>
              <Link
                href="/settings/teams"
                className="rounded-2xl transition-shadow duration-200 hover:shadow-md"
              >
                <StatsCard
                  title="Team Members"
                  value={stats.activeTeamMembers}
                  icon={Users}
                  colour="oklch(0.45 0.10 265)"
                />
              </Link>
              <Link
                href="/skills"
                className="rounded-2xl transition-shadow duration-200 hover:shadow-md"
              >
                <StatsCard
                  title="By Type"
                  value={stats.totalPackages}
                  icon={Activity}
                  colour="oklch(0.50 0.12 330)"
                >
                  <TypeBreakdown byType={stats.byType} typeDisplay={PACKAGE_TYPE_DISPLAY} />
                </StatsCard>
              </Link>
            </div>
          </FadeIn>

          {/* Secondary stats row */}
          <FadeIn delay={150}>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="flex items-center gap-3 rounded-2xl border border-border bg-card p-4">
                <div
                  className="flex size-10 items-center justify-center rounded-2xl"
                  style={{
                    backgroundColor: 'color-mix(in oklch, oklch(0.44 0.12 165) 10%, transparent)',
                    color: 'oklch(0.44 0.12 165)',
                  }}
                >
                  <GitBranch className="size-5" />
                </div>
                <div>
                  <p className="text-muted-foreground text-sm">Git-linked Skills</p>
                  <p className="font-display font-semibold text-xl">{stats.gitLinkedCount}</p>
                </div>
              </div>
              <div className="flex items-center gap-3 rounded-2xl border border-border bg-card p-4">
                <div
                  className="flex size-10 items-center justify-center rounded-2xl"
                  style={{
                    backgroundColor: 'color-mix(in oklch, oklch(0.55 0.15 50) 10%, transparent)',
                    color: 'oklch(0.55 0.15 50)',
                  }}
                >
                  <Lightbulb className="size-5" />
                </div>
                <div>
                  <p className="text-muted-foreground text-sm">Open Proposals</p>
                  <p className="font-display font-semibold text-xl">{stats.openProposals}</p>
                </div>
              </div>
              <div className="flex items-center gap-3 rounded-2xl border border-border bg-card p-4">
                <div
                  className="flex size-10 items-center justify-center rounded-2xl"
                  style={{
                    backgroundColor: 'color-mix(in oklch, oklch(0.55 0.15 30) 10%, transparent)',
                    color: 'oklch(0.55 0.15 30)',
                  }}
                >
                  <AlertTriangle className="size-5" />
                </div>
                <div>
                  <p className="text-muted-foreground text-sm">Modified Installations</p>
                  <p className="font-display font-semibold text-xl">
                    {stats.modifiedInstallations}
                  </p>
                </div>
              </div>
            </div>
          </FadeIn>
        </>
      ) : null}

      {/* Three-column layout */}
      <FadeIn delay={200}>
        <div className="grid gap-6 lg:grid-cols-3">
          {/* Recent Packages */}
          <div className="rounded-2xl border border-border bg-card">
            <div className="flex items-center justify-between border-border/60 border-b px-6 py-4">
              <h2 className="font-display font-semibold text-lg tracking-tight">Recent Packages</h2>
              <Link
                href="/skills"
                className="text-muted-foreground text-sm transition-colors hover:text-primary"
              >
                View all <span aria-hidden>→</span>
              </Link>
            </div>
            <div className="p-3">
              {packagesLoading ? (
                <RecentPackagesLoading />
              ) : recentPackages && recentPackages.length > 0 ? (
                <div className="space-y-1">
                  {recentPackages.map((pkg) => (
                    <Link
                      key={pkg.id}
                      href={`/skills/${pkg.organisation.slug}/${pkg.name}`}
                      className="flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-muted/50"
                    >
                      <div className="flex size-7 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                        <Package className="size-3.5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate font-medium text-sm">{pkg.name}</span>
                          <span
                            className={cn(
                              'shrink-0 rounded-full px-2 py-0.5 font-medium text-xs',
                              PACKAGE_TYPE_DISPLAY[pkg.type]?.colour ??
                                'bg-secondary text-secondary-foreground'
                            )}
                          >
                            {PACKAGE_TYPE_DISPLAY[pkg.type]?.label ?? pkg.type.toLowerCase()}
                          </span>
                        </div>
                        <p className="text-muted-foreground text-xs">
                          {pkg.organisation.slug}
                          {pkg.gitUri && (
                            <span className="ml-1">
                              &middot; <GitBranch className="inline size-3" /> {pkg.gitDefaultRef}
                            </span>
                          )}{' '}
                          &middot; {formatRelativeTime(new Date(pkg.updatedAt))}
                        </p>
                      </div>
                    </Link>
                  ))}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <div className="flex size-10 items-center justify-center rounded-2xl bg-primary-light text-primary">
                    <Package className="size-4" />
                  </div>
                  <p className="mt-3 text-muted-foreground text-sm">
                    No packages yet. Register your first skill from Git!
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Recent Installations */}
          <div className="rounded-2xl border border-border bg-card">
            <div className="flex items-center justify-between border-border/60 border-b px-6 py-4">
              <h2 className="font-display font-semibold text-lg tracking-tight">
                Recent Installations
              </h2>
              <Link
                href="/skills"
                className="text-muted-foreground text-sm transition-colors hover:text-primary"
              >
                View all <span aria-hidden>→</span>
              </Link>
            </div>
            <div className="p-3">
              {installationsLoading ? (
                <InstallationsLoading />
              ) : recentInstallations && recentInstallations.length > 0 ? (
                <div className="space-y-1">
                  {recentInstallations.map((report) => (
                    <Link
                      key={report.id}
                      href={`/skills/${report.package.organisation.slug}/${report.package.name}`}
                      className="flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-muted/50"
                    >
                      <div className="flex size-7 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                        <Monitor className="size-3.5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate font-medium text-sm">
                            {report.package.name}
                          </span>
                          {report.modified && (
                            <Badge
                              variant="outline"
                              className="border-amber-300 bg-amber-50 text-amber-800 text-xs"
                            >
                              Modified
                            </Badge>
                          )}
                        </div>
                        <p className="text-muted-foreground text-xs">
                          {report.user.name ?? report.user.email}
                          {report.version && (
                            <span className="ml-1">&middot; v{report.version.version}</span>
                          )}
                          {report.agents.length > 0 && (
                            <span className="ml-1">&middot; {report.agents.join(', ')}</span>
                          )}{' '}
                          &middot; {formatRelativeTime(new Date(report.lastSeenAt))}
                        </p>
                      </div>
                    </Link>
                  ))}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <div className="flex size-10 items-center justify-center rounded-2xl bg-primary-light text-primary">
                    <Monitor className="size-4" />
                  </div>
                  <p className="mt-3 text-muted-foreground text-sm">No installations yet.</p>
                </div>
              )}
            </div>
          </div>

          {/* Recent Activity */}
          <div className="rounded-2xl border border-border bg-card">
            <div className="flex items-center justify-between border-border/60 border-b px-6 py-4">
              <h2 className="font-display font-semibold text-lg tracking-tight">Recent Activity</h2>
              <Link
                href="/settings/activity"
                className="text-muted-foreground text-sm transition-colors hover:text-primary"
              >
                View all <span aria-hidden>→</span>
              </Link>
            </div>
            <div className="p-3">
              {activityLoading ? (
                <ActivityLoading />
              ) : (
                <ActivityFeed entries={recentActivity ?? []} />
              )}
            </div>
          </div>
        </div>
      </FadeIn>

      {/* Installation Map */}
      <FadeIn delay={250}>
        <InstallationMapWidget />
      </FadeIn>

      {/* Getting Started */}
      {!progressLoading && progress && (
        <FadeIn delay={300}>
          <GettingStarted progress={progress} />
        </FadeIn>
      )}
    </div>
  )
}

function InstallationMapWidget() {
  const { data, isLoading } = trpc.dashboard.getInstallationMap.useQuery()

  if (isLoading) {
    return (
      <div className="rounded-2xl border border-border bg-card">
        <div className="border-border/60 border-b px-6 py-4">
          <h2 className="font-display font-semibold text-lg tracking-tight">Installation Map</h2>
        </div>
        <div className="p-6">
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        </div>
      </div>
    )
  }

  if (!data || data.length === 0) {
    return null
  }

  // Group by package
  type PackageGroup = {
    packageId: string
    packageName: string
    packageSlug: string
    orgSlug: string
    members: Array<{
      userId: string
      userName: string
      userImage: string | null
      agents: string[]
      machineId: string | null
      modified: boolean
    }>
  }

  const packageMap = new Map<string, PackageGroup>()
  for (const report of data) {
    const existing = packageMap.get(report.package.id)
    const member = {
      userId: report.user.id,
      userName: report.user.name ?? report.user.email,
      userImage: report.user.image,
      agents: report.agents,
      machineId: report.machineId,
      modified: report.modified,
    }

    if (existing) {
      existing.members.push(member)
    } else {
      packageMap.set(report.package.id, {
        packageId: report.package.id,
        packageName: report.package.name,
        packageSlug: report.package.slug,
        orgSlug: report.package.organisation.slug,
        members: [member],
      })
    }
  }

  const groups = Array.from(packageMap.values())

  return (
    <div className="rounded-2xl border border-border bg-card">
      <div className="border-border/60 border-b px-6 py-4">
        <h2 className="font-display font-semibold text-lg tracking-tight">Installation Map</h2>
        <p className="mt-0.5 text-muted-foreground text-xs">
          Which skills are installed by which team members.
        </p>
      </div>
      <div className="divide-y divide-border">
        {groups.map((group) => (
          <div key={group.packageId} className="px-6 py-4">
            <Link
              href={`/skills/${group.orgSlug}/${group.packageName}`}
              className="font-display font-medium text-sm hover:underline"
            >
              {group.orgSlug}/{group.packageName}
            </Link>
            <div className="mt-2 flex flex-wrap gap-2">
              {group.members.map((member, idx) => (
                <div
                  key={`${member.userId}-${idx}`}
                  className={cn(
                    'flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs',
                    member.modified
                      ? 'border-amber-300 bg-amber-50 text-amber-800'
                      : 'border-border bg-muted/50'
                  )}
                >
                  {member.userImage ? (
                    <img src={member.userImage} alt="" className="size-4 rounded-full" />
                  ) : (
                    <div className="flex size-4 items-center justify-center rounded-full bg-muted font-medium text-[10px]">
                      {member.userName.charAt(0).toUpperCase()}
                    </div>
                  )}
                  <span>{member.userName}</span>
                  {member.agents.length > 0 && (
                    <span className="text-muted-foreground">({member.agents.join(', ')})</span>
                  )}
                  {member.machineId && (
                    <span className="font-mono text-muted-foreground">
                      [{member.machineId.slice(0, 6)}]
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
