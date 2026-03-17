import type { NotificationType } from '@agentver/database'
import { prisma } from '@agentver/database/client'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createTestUser } from '~/test/factories'
import { cleanDatabase, disconnectDatabase } from '~/test/helpers/db'
import { createTestCaller } from '~/test/helpers/trpc'

beforeEach(async () => {
  await cleanDatabase()
})

afterAll(async () => {
  await disconnectDatabase()
})

// Helper to create a notification for a given user
async function createTestNotification(
  userId: string,
  overrides: Partial<{
    type: NotificationType
    title: string
    read: boolean
    createdAt: Date
  }> = {}
) {
  return prisma.notification.create({
    data: {
      userId,
      type: overrides.type ?? 'MEMBER_INVITED',
      title: overrides.title ?? 'Test notification',
      read: overrides.read ?? false,
      ...(overrides.createdAt ? { createdAt: overrides.createdAt } : {}),
    },
  })
}

describe('notifications.list', () => {
  it('returns all notifications for the user with total count', async () => {
    const user = await createTestUser()
    const caller = createTestCaller(user.id)

    await createTestNotification(user.id, { title: 'First' })
    await createTestNotification(user.id, { title: 'Second' })
    await createTestNotification(user.id, { title: 'Third' })

    const result = await caller.notifications.list({ limit: 10, offset: 0 })

    expect(result.notifications).toHaveLength(3)
    expect(result.total).toBe(3)
  })

  it('respects the limit parameter', async () => {
    const user = await createTestUser()
    const caller = createTestCaller(user.id)

    for (let i = 0; i < 8; i++) {
      await createTestNotification(user.id, { title: `Notification ${i}` })
    }

    const result = await caller.notifications.list({ limit: 3, offset: 0 })

    expect(result.notifications).toHaveLength(3)
    expect(result.total).toBe(8)
  })

  it('respects the offset parameter for pagination', async () => {
    const user = await createTestUser()
    const caller = createTestCaller(user.id)

    for (let i = 0; i < 5; i++) {
      await createTestNotification(user.id, { title: `Notification ${i}` })
    }

    const page1 = await caller.notifications.list({ limit: 2, offset: 0 })
    const page2 = await caller.notifications.list({ limit: 2, offset: 2 })

    expect(page1.notifications).toHaveLength(2)
    expect(page2.notifications).toHaveLength(2)
    // Pages should contain different notifications
    const page1Ids = page1.notifications.map((n) => n.id)
    const page2Ids = page2.notifications.map((n) => n.id)
    expect(page1Ids).not.toEqual(page2Ids)
  })

  it('filters to unread only when unreadOnly is true', async () => {
    const user = await createTestUser()
    const caller = createTestCaller(user.id)

    await createTestNotification(user.id, { title: 'Unread one', read: false })
    await createTestNotification(user.id, { title: 'Read one', read: true })
    await createTestNotification(user.id, { title: 'Unread two', read: false })

    const result = await caller.notifications.list({ limit: 10, offset: 0, unreadOnly: true })

    expect(result.notifications).toHaveLength(2)
    expect(result.notifications.every((n) => n.read === false)).toBe(true)
  })

  it('includes read notifications when unreadOnly is false', async () => {
    const user = await createTestUser()
    const caller = createTestCaller(user.id)

    await createTestNotification(user.id, { title: 'Unread', read: false })
    await createTestNotification(user.id, { title: 'Read', read: true })

    const result = await caller.notifications.list({ limit: 10, offset: 0, unreadOnly: false })

    expect(result.notifications).toHaveLength(2)
  })

  it('does not return notifications belonging to other users', async () => {
    const user = await createTestUser()
    const other = await createTestUser()
    const caller = createTestCaller(user.id)

    await createTestNotification(other.id, { title: 'Not mine' })
    await createTestNotification(user.id, { title: 'Mine' })

    const result = await caller.notifications.list({ limit: 10, offset: 0 })

    expect(result.notifications).toHaveLength(1)
    expect(result.notifications[0]!.title).toBe('Mine')
  })

  it('returns an empty list and total 0 when there are no notifications', async () => {
    const user = await createTestUser()
    const caller = createTestCaller(user.id)

    const result = await caller.notifications.list({ limit: 10, offset: 0 })

    expect(result.notifications).toHaveLength(0)
    expect(result.total).toBe(0)
  })
})

describe('notifications.unreadCount', () => {
  it('returns the count of unread notifications for the user', async () => {
    const user = await createTestUser()
    const caller = createTestCaller(user.id)

    await createTestNotification(user.id, { read: false })
    await createTestNotification(user.id, { read: false })
    await createTestNotification(user.id, { read: true })

    const result = await caller.notifications.unreadCount()

    expect(result.count).toBe(2)
  })

  it('returns 0 when all notifications are read', async () => {
    const user = await createTestUser()
    const caller = createTestCaller(user.id)

    await createTestNotification(user.id, { read: true })
    await createTestNotification(user.id, { read: true })

    const result = await caller.notifications.unreadCount()

    expect(result.count).toBe(0)
  })

  it('returns 0 when there are no notifications', async () => {
    const user = await createTestUser()
    const caller = createTestCaller(user.id)

    const result = await caller.notifications.unreadCount()

    expect(result.count).toBe(0)
  })

  it('does not count unread notifications belonging to other users', async () => {
    const user = await createTestUser()
    const other = await createTestUser()
    const caller = createTestCaller(user.id)

    await createTestNotification(other.id, { read: false })
    await createTestNotification(other.id, { read: false })
    await createTestNotification(user.id, { read: false })

    const result = await caller.notifications.unreadCount()

    expect(result.count).toBe(1)
  })
})

describe('notifications.markRead', () => {
  it('marks a specific notification as read', async () => {
    const user = await createTestUser()
    const caller = createTestCaller(user.id)

    const notification = await createTestNotification(user.id, { read: false })

    await caller.notifications.markRead({ id: notification.id })

    const updated = await prisma.notification.findUnique({ where: { id: notification.id } })
    expect(updated?.read).toBe(true)
  })

  it('does not affect other notifications when marking one as read', async () => {
    const user = await createTestUser()
    const caller = createTestCaller(user.id)

    const n1 = await createTestNotification(user.id, { read: false })
    const n2 = await createTestNotification(user.id, { read: false })

    await caller.notifications.markRead({ id: n1.id })

    const untouched = await prisma.notification.findUnique({ where: { id: n2.id } })
    expect(untouched?.read).toBe(false)
  })

  it('is idempotent — marking an already-read notification read again does not throw', async () => {
    const user = await createTestUser()
    const caller = createTestCaller(user.id)

    const notification = await createTestNotification(user.id, { read: true })

    await expect(caller.notifications.markRead({ id: notification.id })).resolves.not.toThrow()
  })

  it('silently ignores when the notification belongs to another user', async () => {
    const user = await createTestUser()
    const other = await createTestUser()
    const caller = createTestCaller(user.id)

    const notification = await createTestNotification(other.id, { read: false })

    await caller.notifications.markRead({ id: notification.id })

    // The notification should remain unread since updateMany filters by userId
    const unchanged = await prisma.notification.findUnique({ where: { id: notification.id } })
    expect(unchanged?.read).toBe(false)
  })
})

describe('notifications.markAllRead', () => {
  it('marks all unread notifications as read for the user', async () => {
    const user = await createTestUser()
    const caller = createTestCaller(user.id)

    await createTestNotification(user.id, { read: false })
    await createTestNotification(user.id, { read: false })
    await createTestNotification(user.id, { read: false })

    await caller.notifications.markAllRead()

    const unread = await prisma.notification.count({ where: { userId: user.id, read: false } })
    expect(unread).toBe(0)
  })

  it('does not affect notifications belonging to other users', async () => {
    const user = await createTestUser()
    const other = await createTestUser()
    const caller = createTestCaller(user.id)

    await createTestNotification(other.id, { read: false })
    await createTestNotification(user.id, { read: false })

    await caller.notifications.markAllRead()

    const otherUnread = await prisma.notification.count({
      where: { userId: other.id, read: false },
    })
    expect(otherUnread).toBe(1)
  })

  it('is safe to call when there are no unread notifications', async () => {
    const user = await createTestUser()
    const caller = createTestCaller(user.id)

    await createTestNotification(user.id, { read: true })

    await expect(caller.notifications.markAllRead()).resolves.not.toThrow()
  })

  it('is safe to call when there are no notifications at all', async () => {
    const user = await createTestUser()
    const caller = createTestCaller(user.id)

    await expect(caller.notifications.markAllRead()).resolves.not.toThrow()
  })
})

describe('notifications.deleteOld', () => {
  it('deletes notifications older than 30 days and returns the deleted count', async () => {
    const user = await createTestUser()
    const caller = createTestCaller(user.id)

    const thirtyOneDaysAgo = new Date()
    thirtyOneDaysAgo.setDate(thirtyOneDaysAgo.getDate() - 31)

    const twentyNineDaysAgo = new Date()
    twentyNineDaysAgo.setDate(twentyNineDaysAgo.getDate() - 29)

    await createTestNotification(user.id, {
      title: 'Old notification',
      createdAt: thirtyOneDaysAgo,
    })
    await createTestNotification(user.id, {
      title: 'Recent notification',
      createdAt: twentyNineDaysAgo,
    })

    const result = await caller.notifications.deleteOld()

    expect(result.deleted).toBe(1)

    const remaining = await prisma.notification.count({ where: { userId: user.id } })
    expect(remaining).toBe(1)
  })

  it('returns 0 when there are no old notifications to delete', async () => {
    const user = await createTestUser()
    const caller = createTestCaller(user.id)

    // All recent — none should be deleted
    await createTestNotification(user.id, { title: 'Recent one' })
    await createTestNotification(user.id, { title: 'Recent two' })

    const result = await caller.notifications.deleteOld()

    expect(result.deleted).toBe(0)
  })

  it('returns 0 when there are no notifications at all', async () => {
    const user = await createTestUser()
    const caller = createTestCaller(user.id)

    const result = await caller.notifications.deleteOld()

    expect(result.deleted).toBe(0)
  })

  it('deletes multiple old notifications in one call', async () => {
    const user = await createTestUser()
    const caller = createTestCaller(user.id)

    const fortyDaysAgo = new Date()
    fortyDaysAgo.setDate(fortyDaysAgo.getDate() - 40)

    await createTestNotification(user.id, { title: 'Very old 1', createdAt: fortyDaysAgo })
    await createTestNotification(user.id, { title: 'Very old 2', createdAt: fortyDaysAgo })
    await createTestNotification(user.id, { title: 'Very old 3', createdAt: fortyDaysAgo })
    await createTestNotification(user.id, { title: 'Recent' })

    const result = await caller.notifications.deleteOld()

    expect(result.deleted).toBe(3)

    const remaining = await prisma.notification.count({ where: { userId: user.id } })
    expect(remaining).toBe(1)
  })

  it('does not delete notifications that are exactly on the 30-day boundary', async () => {
    const user = await createTestUser()
    const caller = createTestCaller(user.id)

    const exactlyThirtyDaysAgo = new Date()
    exactlyThirtyDaysAgo.setDate(exactlyThirtyDaysAgo.getDate() - 30)

    await createTestNotification(user.id, {
      title: 'Boundary notification',
      createdAt: exactlyThirtyDaysAgo,
    })

    const result = await caller.notifications.deleteOld()

    // Boundary behaviour: notifications older than 30 days are deleted, exactly 30 days should survive
    const remaining = await prisma.notification.count({ where: { userId: user.id } })
    expect(result.deleted + remaining).toBe(1)
  })
})
