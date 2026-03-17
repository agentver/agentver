'use client'

import { Button } from '@agentver/ui/components/button'
import { Skeleton } from '@agentver/ui/components/skeleton'
import { cn } from '@agentver/ui-utils'
import { Bell, CheckCheck } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import {
  formatNotificationTime,
  getNotificationHref,
  getNotificationIcon,
} from '@/lib/notification-routing'
import { trpc } from '@/trpc/client'

const PAGE_SIZE = 20

export default function NotificationsPage() {
  const [filter, setFilter] = useState<'all' | 'unread'>('all')
  const [offset, setOffset] = useState(0)
  const router = useRouter()
  const utils = trpc.useUtils()

  const { data, isLoading } = trpc.notifications.list.useQuery({
    limit: PAGE_SIZE,
    offset,
    unreadOnly: filter === 'unread',
  })

  const markReadMutation = trpc.notifications.markRead.useMutation({
    onSuccess: () => {
      utils.notifications.unreadCount.invalidate()
      utils.notifications.list.invalidate()
    },
  })

  const markAllReadMutation = trpc.notifications.markAllRead.useMutation({
    onSuccess: () => {
      utils.notifications.unreadCount.invalidate()
      utils.notifications.list.invalidate()
    },
  })

  const notifications = data?.notifications ?? []
  const total = data?.total ?? 0
  const hasMore = offset + PAGE_SIZE < total
  const hasPrev = offset > 0

  const handleNotificationClick = (notification: (typeof notifications)[number]) => {
    if (!notification.read) {
      markReadMutation.mutate({ id: notification.id })
    }

    const href = getNotificationHref(
      notification.type,
      notification.resourceId,
      notification.resourceType
    )

    if (href) {
      router.push(href)
    }
  }

  const handleFilterChange = (newFilter: 'all' | 'unread') => {
    setFilter(newFilter)
    setOffset(0)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="font-display font-semibold text-3xl tracking-tight">Notifications</h2>
          <p className="text-muted-foreground leading-relaxed">
            Stay up to date with activity across your packages and organisations.
          </p>
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={() => markAllReadMutation.mutate()}
          disabled={markAllReadMutation.isPending}
        >
          <CheckCheck className="size-4" />
          Mark all as read
        </Button>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 rounded-lg bg-muted p-1">
        <button
          type="button"
          onClick={() => handleFilterChange('all')}
          className={cn(
            'rounded-md px-3 py-1.5 font-medium text-sm transition-colors',
            filter === 'all'
              ? 'bg-background text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground'
          )}
        >
          All
        </button>
        <button
          type="button"
          onClick={() => handleFilterChange('unread')}
          className={cn(
            'rounded-md px-3 py-1.5 font-medium text-sm transition-colors',
            filter === 'unread'
              ? 'bg-background text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground'
          )}
        >
          Unread
        </button>
      </div>

      {/* Notification list */}
      {isLoading ? (
        <div className="space-y-1">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex items-start gap-3 rounded-lg px-4 py-3">
              <Skeleton className="size-8 shrink-0 rounded-lg" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-4 w-64" />
                <Skeleton className="h-3 w-40" />
                <Skeleton className="h-3 w-20" />
              </div>
            </div>
          ))}
        </div>
      ) : notifications.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-border border-dashed py-20">
          <div className="flex size-12 items-center justify-center rounded-2xl bg-primary-light text-primary">
            <Bell className="size-5" />
          </div>
          <p className="mt-4 font-display font-medium text-lg">You're all caught up!</p>
          <p className="mt-1 max-w-sm text-center text-muted-foreground text-sm">
            {filter === 'unread'
              ? 'No unread notifications. Switch to "All" to see your history.'
              : 'No notifications yet. Activity from your packages and organisations will appear here.'}
          </p>
        </div>
      ) : (
        <div className="space-y-0.5">
          {notifications.map((notification) => {
            const Icon = getNotificationIcon(notification.type)

            return (
              <button
                key={notification.id}
                type="button"
                onClick={() => handleNotificationClick(notification)}
                className={cn(
                  'flex w-full items-start gap-3 rounded-lg px-4 py-3 text-left transition-colors hover:bg-muted/50',
                  !notification.read && 'bg-accent/30'
                )}
              >
                <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                  <Icon className="size-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <p
                    className={cn(
                      'text-sm',
                      !notification.read ? 'font-medium' : 'text-foreground'
                    )}
                  >
                    {notification.title}
                  </p>
                  {notification.body && (
                    <p className="mt-0.5 line-clamp-2 text-muted-foreground text-sm">
                      {notification.body}
                    </p>
                  )}
                  <p className="mt-1 text-muted-foreground text-xs">
                    {formatNotificationTime(new Date(notification.createdAt))}
                  </p>
                </div>
                {!notification.read && (
                  <div className="mt-2 size-2 shrink-0 rounded-full bg-blue-500" />
                )}
              </button>
            )
          })}
        </div>
      )}

      {/* Pagination */}
      {(hasPrev || hasMore) && (
        <div className="flex items-center justify-between border-border/60 border-t pt-4">
          <p className="text-muted-foreground text-sm">
            Showing {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} of {total}
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={!hasPrev}
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!hasMore}
              onClick={() => setOffset(offset + PAGE_SIZE)}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
