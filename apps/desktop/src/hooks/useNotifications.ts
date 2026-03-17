import { fetch } from '@tauri-apps/plugin-http'
import { useCallback, useEffect, useState } from 'react'
import { getAuthData } from '../lib/auth'

type Notification = {
  id: string
  type: string
  message: string
  read: boolean
  createdAt: string
  link?: string
}

type NotificationsResponse = {
  notifications: Notification[]
  unreadCount: number
}

export function useNotifications() {
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [loading, setLoading] = useState(false)

  const fetchNotifications = useCallback(async () => {
    const auth = await getAuthData()
    if (!auth?.token || !auth.platformUrl) return

    setLoading(true)
    try {
      const response = await fetch(`${auth.platformUrl}/api/v1/notifications`, {
        headers: { Authorization: `Bearer ${auth.token}` },
      })
      if (response.ok) {
        const data = (await response.json()) as NotificationsResponse
        setNotifications(data.notifications ?? [])
        setUnreadCount(data.unreadCount ?? 0)
      }
    } catch {
      // Silently fail — notifications are non-critical
    } finally {
      setLoading(false)
    }
  }, [])

  const markAsRead = useCallback(async (id: string) => {
    const auth = await getAuthData()
    if (!auth?.token || !auth.platformUrl) return

    await fetch(`${auth.platformUrl}/api/v1/notifications/${id}/read`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${auth.token}` },
    }).catch(() => {})

    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)))
    setUnreadCount((prev) => Math.max(0, prev - 1))
  }, [])

  const markAllAsRead = useCallback(async () => {
    const auth = await getAuthData()
    if (!auth?.token || !auth.platformUrl) return

    await fetch(`${auth.platformUrl}/api/v1/notifications/read-all`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${auth.token}` },
    }).catch(() => {})

    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })))
    setUnreadCount(0)
  }, [])

  // Fetch on mount and every 60 seconds
  useEffect(() => {
    fetchNotifications()
    const interval = setInterval(fetchNotifications, 60_000)
    return () => clearInterval(interval)
  }, [fetchNotifications])

  return { notifications, unreadCount, loading, fetchNotifications, markAsRead, markAllAsRead }
}

export type { Notification }
