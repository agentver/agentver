import { cn } from '@agentver/ui-utils'
import { useEffect, useRef } from 'react'
import type { Notification } from '../hooks/useNotifications'

type NotificationPanelProps = {
  open: boolean
  notifications: Notification[]
  unreadCount: number
  loading: boolean
  onClose: () => void
  onMarkAsRead: (id: string) => void
  onMarkAllAsRead: () => void
}

function formatRelativeTime(dateString: string): string {
  const now = Date.now()
  const date = new Date(dateString).getTime()
  const diffSeconds = Math.floor((now - date) / 1000)

  if (diffSeconds < 60) return 'just now'
  if (diffSeconds < 3600) {
    const mins = Math.floor(diffSeconds / 60)
    return `${mins}m ago`
  }
  if (diffSeconds < 86400) {
    const hours = Math.floor(diffSeconds / 3600)
    return `${hours}h ago`
  }
  const days = Math.floor(diffSeconds / 86400)
  return `${days}d ago`
}

function BellIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 18 18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M13.5 6.75a4.5 4.5 0 10-9 0c0 5.25-2.25 6.75-2.25 6.75h13.5s-2.25-1.5-2.25-6.75" />
      <path d="M10.3 15.75a1.5 1.5 0 01-2.6 0" />
    </svg>
  )
}

export function NotificationBell({
  unreadCount,
  onClick,
}: {
  unreadCount: number
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className="relative flex shrink-0 cursor-pointer items-center justify-center rounded-md border-none bg-transparent p-1.5 text-muted-foreground transition-all hover:bg-muted hover:text-foreground"
      title="Notifications"
    >
      <BellIcon />
      {unreadCount > 0 && (
        <span className="absolute top-0 right-0 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 font-bold text-[0.6rem] text-white leading-none">
          {unreadCount > 99 ? '99+' : unreadCount}
        </span>
      )}
    </button>
  )
}

export function NotificationPanel({
  open,
  notifications,
  unreadCount,
  loading,
  onClose,
  onMarkAsRead,
  onMarkAllAsRead,
}: NotificationPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return

    function handleClickOutside(event: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) {
        onClose()
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      ref={panelRef}
      className="absolute top-full right-0 z-[1000] mt-1 flex max-h-[400px] w-[340px] flex-col overflow-hidden rounded-xl border border-border bg-popover shadow-lg"
    >
      <div className="flex shrink-0 items-center justify-between border-border border-b px-4 py-3">
        <span className="font-semibold text-foreground text-sm">Notifications</span>
        {unreadCount > 0 && (
          <button
            onClick={onMarkAllAsRead}
            className="cursor-pointer border-none bg-transparent p-0 text-muted-foreground text-xs transition-colors hover:text-primary"
          >
            Mark all as read
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading && notifications.length === 0 && (
          <div className="flex items-center justify-center px-4 py-8">
            <span className="text-[0.825rem] text-muted-foreground">Loading...</span>
          </div>
        )}

        {!loading && notifications.length === 0 && (
          <div className="flex items-center justify-center px-4 py-8">
            <span className="text-[0.825rem] text-muted-foreground">No notifications</span>
          </div>
        )}

        {notifications.map((notification) => (
          <NotificationItem
            key={notification.id}
            notification={notification}
            onMarkAsRead={onMarkAsRead}
          />
        ))}
      </div>
    </div>
  )
}

function NotificationItem({
  notification,
  onMarkAsRead,
}: {
  notification: Notification
  onMarkAsRead: (id: string) => void
}) {
  return (
    <button
      onClick={() => {
        if (!notification.read) {
          onMarkAsRead(notification.id)
        }
      }}
      className="flex w-full cursor-pointer border-border border-b border-none bg-transparent px-4 py-3 text-left font-[inherit] transition-colors hover:bg-muted"
    >
      <div className="flex w-full items-start gap-2">
        {!notification.read && <span className="mt-1 size-2 shrink-0 rounded-full bg-primary" />}
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span
            className={cn(
              'text-[0.825rem] leading-snug',
              notification.read ? 'text-muted-foreground' : 'text-foreground'
            )}
          >
            {notification.message}
          </span>
          <span className="text-[0.7rem] text-muted-foreground">
            {formatRelativeTime(notification.createdAt)}
          </span>
        </div>
      </div>
    </button>
  )
}
