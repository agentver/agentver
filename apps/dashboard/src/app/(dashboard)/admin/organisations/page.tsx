'use client'

import { Badge } from '@agentver/ui/components/badge'
import { Button } from '@agentver/ui/components/button'
import { Input } from '@agentver/ui/components/input'
import { Skeleton } from '@agentver/ui/components/skeleton'
import {
  ArrowLeft,
  Building2,
  ChevronLeft,
  ChevronRight,
  Package,
  Search,
  Shield,
  Users,
} from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'
import { trpc } from '@/trpc/client'

function formatDate(date: Date): string {
  return new Date(date).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

function AccessDenied() {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="flex size-14 items-center justify-center rounded-2xl bg-destructive/10 text-destructive">
        <Shield className="size-7" />
      </div>
      <h2 className="mt-4 font-display font-semibold text-xl">Access Denied</h2>
      <p className="mt-2 max-w-md text-muted-foreground">
        You do not have permission to access the platform admin area.
      </p>
    </div>
  )
}

function TableLoading() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 10 }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 py-3">
          <Skeleton className="size-8 rounded-lg" />
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-4 w-20" />
        </div>
      ))}
    </div>
  )
}

export default function AdminOrganisationsPage() {
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [searchInput, setSearchInput] = useState('')

  const { data, isLoading, error } = trpc.admin!.listOrganisations.useQuery({
    page,
    perPage: 25,
    search: search || undefined,
  })

  if (error?.data?.code === 'FORBIDDEN') {
    return <AccessDenied />
  }

  function handleSearch(e: React.FormEvent) {
    e.preventDefault()
    setSearch(searchInput)
    setPage(1)
  }

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/admin"
          className="mb-4 inline-flex items-center gap-1.5 text-muted-foreground text-sm transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Back to Admin
        </Link>
        <h1 className="font-display font-semibold text-3xl tracking-tight">Organisations</h1>
        <p className="mt-1 text-muted-foreground">
          {data ? `${data.total} organisations on the platform.` : 'Loading organisations...'}
        </p>
      </div>

      <form onSubmit={handleSearch} className="flex gap-3">
        <div className="relative flex-1">
          <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search by name or slug..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="pl-10"
          />
        </div>
        <Button type="submit" variant="secondary">
          Search
        </Button>
        {search && (
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setSearch('')
              setSearchInput('')
              setPage(1)
            }}
          >
            Clear
          </Button>
        )}
      </form>

      <div className="rounded-2xl border border-border bg-card">
        {isLoading ? (
          <div className="p-6">
            <TableLoading />
          </div>
        ) : data && data.organisations.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-border/60 border-b text-left">
                  <th className="px-6 py-3 font-medium text-muted-foreground text-xs uppercase tracking-wider">
                    Organisation
                  </th>
                  <th className="px-6 py-3 font-medium text-muted-foreground text-xs uppercase tracking-wider">
                    Slug
                  </th>
                  <th className="px-6 py-3 font-medium text-muted-foreground text-xs uppercase tracking-wider">
                    <div className="flex items-center gap-1">
                      <Users className="size-3.5" />
                      Members
                    </div>
                  </th>
                  <th className="px-6 py-3 font-medium text-muted-foreground text-xs uppercase tracking-wider">
                    <div className="flex items-center gap-1">
                      <Package className="size-3.5" />
                      Packages
                    </div>
                  </th>
                  <th className="px-6 py-3 font-medium text-muted-foreground text-xs uppercase tracking-wider">
                    Created
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {data.organisations.map((org) => (
                  <tr key={org.id} className="transition-colors hover:bg-muted/30">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        {org.image ? (
                          <img src={org.image} alt="" className="size-8 rounded-lg" />
                        ) : (
                          <div className="flex size-8 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                            <Building2 className="size-4" />
                          </div>
                        )}
                        <p className="font-medium text-sm">{org.name}</p>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <Badge variant="secondary" className="font-mono text-xs">
                        {org.slug}
                      </Badge>
                    </td>
                    <td className="px-6 py-4 text-sm">{org.memberCount}</td>
                    <td className="px-6 py-4 text-sm">{org.packageCount}</td>
                    <td className="px-6 py-4 text-muted-foreground text-sm">
                      {formatDate(org.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <p className="text-muted-foreground text-sm">
              {search ? 'No organisations match your search.' : 'No organisations found.'}
            </p>
          </div>
        )}

        {data && data.totalPages > 1 && (
          <div className="flex items-center justify-between border-border/60 border-t px-6 py-4">
            <p className="text-muted-foreground text-sm">
              Page {data.page} of {data.totalPages} ({data.total} total)
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
              >
                <ChevronLeft className="size-4" />
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.min(data.totalPages, p + 1))}
                disabled={page >= data.totalPages}
              >
                Next
                <ChevronRight className="size-4" />
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
