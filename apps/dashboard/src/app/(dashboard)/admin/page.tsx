'use client'

import { Skeleton } from '@agentver/ui/components/skeleton'
import { Building2, Package, Shield, Users } from 'lucide-react'
import Link from 'next/link'
import { trpc } from '@/trpc/client'

function StatCard({
  title,
  value,
  icon: Icon,
  href,
}: {
  title: string
  value: number | undefined
  icon: React.ComponentType<{ className?: string }>
  href?: string
}) {
  const content = (
    <div className="rounded-2xl border border-border bg-card p-6 transition-colors hover:bg-muted/30">
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <p className="text-muted-foreground text-sm">{title}</p>
          {value !== undefined ? (
            <p className="font-display font-semibold text-3xl tracking-tight">{value}</p>
          ) : (
            <Skeleton className="h-9 w-16" />
          )}
        </div>
        <div className="flex size-10 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <Icon className="size-5" />
        </div>
      </div>
    </div>
  )

  if (href) {
    return <Link href={href}>{content}</Link>
  }

  return content
}

function AccessDenied() {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="flex size-14 items-center justify-center rounded-2xl bg-destructive/10 text-destructive">
        <Shield className="size-7" />
      </div>
      <h2 className="mt-4 font-display font-semibold text-xl">Access Denied</h2>
      <p className="mt-2 max-w-md text-muted-foreground">
        You do not have permission to access the platform admin area. Contact a platform
        administrator if you believe this is an error.
      </p>
    </div>
  )
}

export default function AdminDashboardPage() {
  const { data: stats, error } = trpc.admin!.getStats.useQuery()

  if (error?.data?.code === 'FORBIDDEN') {
    return <AccessDenied />
  }

  return (
    <div className="space-y-8">
      <div>
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <Shield className="size-5" />
          </div>
          <div>
            <h1 className="font-display font-semibold text-3xl tracking-tight">Platform Admin</h1>
            <p className="text-muted-foreground text-sm">System-wide overview and management.</p>
          </div>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard title="Total Users" value={stats?.totalUsers} icon={Users} href="/admin/users" />
        <StatCard
          title="Total Organisations"
          value={stats?.totalOrganisations}
          icon={Building2}
          href="/admin/organisations"
        />
        <StatCard title="Total Packages" value={stats?.totalPackages} icon={Package} />
        <StatCard title="Total Skills" value={stats?.totalSkills} icon={Package} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Link
          href="/admin/users"
          className="flex items-center gap-4 rounded-2xl border border-border bg-card p-6 transition-colors hover:bg-muted/30"
        >
          <div className="flex size-10 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
            <Users className="size-5" />
          </div>
          <div>
            <p className="font-medium">Manage Users</p>
            <p className="text-muted-foreground text-sm">
              View, search, and manage platform users.
            </p>
          </div>
        </Link>
        <Link
          href="/admin/organisations"
          className="flex items-center gap-4 rounded-2xl border border-border bg-card p-6 transition-colors hover:bg-muted/30"
        >
          <div className="flex size-10 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
            <Building2 className="size-5" />
          </div>
          <div>
            <p className="font-medium">Manage Organisations</p>
            <p className="text-muted-foreground text-sm">
              View and search all organisations on the platform.
            </p>
          </div>
        </Link>
      </div>
    </div>
  )
}
