'use client'

import { Badge } from '@agentver/ui/components/badge'
import { Button } from '@agentver/ui/components/button'
import { Input } from '@agentver/ui/components/input'
import { Skeleton } from '@agentver/ui/components/skeleton'
import { ArrowLeft, ChevronLeft, ChevronRight, Search, Shield, UserX } from 'lucide-react'
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
          <Skeleton className="size-8 rounded-full" />
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-4 w-20" />
        </div>
      ))}
    </div>
  )
}

export default function AdminUsersPage() {
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [searchInput, setSearchInput] = useState('')

  const utils = trpc.useUtils()

  const { data, isLoading, error } = trpc.admin!.listUsers.useQuery({
    page,
    perPage: 25,
    search: search || undefined,
  })

  const suspendMutation = trpc.admin!.suspendUser.useMutation({
    onSuccess: () => utils.admin!.listUsers.invalidate(),
  })

  const unsuspendMutation = trpc.admin!.unsuspendUser.useMutation({
    onSuccess: () => utils.admin!.listUsers.invalidate(),
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
        <h1 className="font-display font-semibold text-3xl tracking-tight">Users</h1>
        <p className="mt-1 text-muted-foreground">
          {data ? `${data.total} users on the platform.` : 'Loading users...'}
        </p>
      </div>

      <form onSubmit={handleSearch} className="flex gap-3">
        <div className="relative flex-1">
          <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search by email, name, or username..."
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
        ) : data && data.users.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-border/60 border-b text-left">
                  <th className="px-6 py-3 font-medium text-muted-foreground text-xs uppercase tracking-wider">
                    User
                  </th>
                  <th className="px-6 py-3 font-medium text-muted-foreground text-xs uppercase tracking-wider">
                    Email
                  </th>
                  <th className="px-6 py-3 font-medium text-muted-foreground text-xs uppercase tracking-wider">
                    Orgs
                  </th>
                  <th className="px-6 py-3 font-medium text-muted-foreground text-xs uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-6 py-3 font-medium text-muted-foreground text-xs uppercase tracking-wider">
                    Joined
                  </th>
                  <th className="px-6 py-3 font-medium text-muted-foreground text-xs uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {data.users.map((user) => (
                  <tr key={user.id} className="transition-colors hover:bg-muted/30">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        {user.image ? (
                          <img src={user.image} alt="" className="size-8 rounded-full" />
                        ) : (
                          <div className="flex size-8 items-center justify-center rounded-full bg-muted font-medium text-muted-foreground text-xs">
                            {(user.name ?? user.email).charAt(0).toUpperCase()}
                          </div>
                        )}
                        <div>
                          <p className="font-medium text-sm">{user.name ?? 'Unnamed'}</p>
                          {user.username && (
                            <p className="text-muted-foreground text-xs">@{user.username}</p>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-sm">{user.email}</td>
                    <td className="px-6 py-4 text-sm">{user.orgCount}</td>
                    <td className="px-6 py-4">
                      {user.suspended ? (
                        <Badge variant="destructive" className="gap-1">
                          <UserX className="size-3" />
                          Suspended
                        </Badge>
                      ) : (
                        <Badge variant="secondary">Active</Badge>
                      )}
                    </td>
                    <td className="px-6 py-4 text-muted-foreground text-sm">
                      {formatDate(user.createdAt)}
                    </td>
                    <td className="px-6 py-4">
                      {user.suspended ? (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => unsuspendMutation.mutate({ userId: user.id })}
                          disabled={unsuspendMutation.isPending}
                        >
                          Unsuspend
                        </Button>
                      ) : (
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => suspendMutation.mutate({ userId: user.id })}
                          disabled={suspendMutation.isPending}
                        >
                          Suspend
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <p className="text-muted-foreground text-sm">
              {search ? 'No users match your search.' : 'No users found.'}
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
