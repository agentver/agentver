'use client'

import { Popover, PopoverContent, PopoverTrigger } from '@agentver/ui/components/popover'
import { Skeleton } from '@agentver/ui/components/skeleton'
import { cn } from '@agentver/ui-utils'
import { Bell, CheckCheck } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import {
  formatNotificationTime,
  getNotificationHref,
  getNotificationIcon,
} from '@/lib/notification-routing'
import { trpc } from '@/trpc/client'

function formatBadgeCount(count: number): string {
  if (count > 99) return '99+'
  return String(count)
}

export function NotificationDropdown() {
  const [open, setOpen] = useState(false)
  const router = useRouter()
  const utils = trpc.useUtils()

  const { data: unreadData } = trpc.notifications.unreadCount.useQuery(undefined, {
    refetchInterval: 30_000,
  })

  const { data: listData, isLoading } = trpc.notifications.list.useQuery(
    { limit: 10 },
    { enabled: open }
  )

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

  const unreadCount = unreadData?.count ?? 0
  const notifications = listData?.notifications ?? []

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
      setOpen(false)
      router.push(href)
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="relative flex items-center justify-center rounded-lg p-2 text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
          aria-label="Notifications"
        >
          <Bell className="size-[18px]" />
          {unreadCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 flex min-w-[18px] items-center justify-center rounded-full bg-destructive px-1 py-0.5 font-semibold text-[10px] text-destructive-foreground leading-none">
              {formatBadgeCount(unreadCount)}
            </span>
          )}
        </button>
      </PopoverTrigger>

      <PopoverContent align="end" className="w-96 p-0">
        <div className="flex items-center justify-between border-border/60 border-b px-4 py-3">
          <h3 className="font-semibold text-sm">Notifications</h3>
          {unreadCount > 0 && (
            <button
              type="button"
              onClick={() => markAllReadMutation.mutate()}
              disabled={markAllReadMutation.isPending}
              className="flex items-center gap-1 text-muted-foreground text-xs transition-colors hover:text-foreground"
            >
              <CheckCheck className="size-3" />
              Mark all as read
            </button>
          )}
        </div>

        <div className="max-h-[400px] overflow-y-auto">
          {isLoading ? (
            <div className="space-y-1 p-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="flex items-start gap-3 px-3 py-2.5">
                  <Skeleton className="size-7 shrink-0 rounded-lg" />
                  <div className="flex-1 space-y-1.5">
                    <Skeleton className="h-4 w-48" />
                    <Skeleton className="h-3 w-24" />
                  </div>
                </div>
              ))}
            </div>
          ) : notifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-center">
              <Bell className="size-5 text-muted-foreground" />
              <p className="mt-2 text-muted-foreground text-sm">No notifications yet</p>
            </div>
          ) : (
            <div className="space-y-0.5 p-1">
              {notifications.map((notification) => {
                const Icon = getNotificationIcon(notification.type)

                return (
                  <button
                    key={notification.id}
                    type="button"
                    onClick={() => handleNotificationClick(notification)}
                    className={cn(
                      'flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-muted/50',
                      !notification.read && 'bg-accent/30'
                    )}
                  >
                    <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                      <Icon className="size-3.5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p
                        className={cn(
                          'truncate text-sm',
                          !notification.read ? 'font-medium' : 'text-foreground'
                        )}
                      >
                        {notification.title}
                      </p>
                      {notification.body && (
                        <p className="mt-0.5 line-clamp-1 text-muted-foreground text-xs">
                          {notification.body}
                        </p>
                      )}
                      <p className="mt-0.5 text-muted-foreground text-xs">
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
        </div>

        <div className="border-border/60 border-t px-4 py-2.5">
          <Link
            href="/notifications"
            onClick={() => setOpen(false)}
            className="block text-center font-medium text-muted-foreground text-xs transition-colors hover:text-foreground"
          >
            View all notifications
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  )
}
