import { expect, test } from '@playwright/test'
import { NotificationsPage } from './pages/notifications'

test.describe('notifications', () => {
  test('notifications page renders', async ({ page }) => {
    const notifications = new NotificationsPage(page)
    await notifications.goto()
    await expect(page).toHaveURL(/\/notifications/)
    await expect(notifications.heading).toBeVisible()
  })

  test('page heading displays correct text', async ({ page }) => {
    const notifications = new NotificationsPage(page)
    await notifications.goto()
    await expect(notifications.heading).toHaveText('Notifications')
  })

  test('filter tabs are visible', async ({ page }) => {
    const notifications = new NotificationsPage(page)
    await notifications.goto()
    await expect(notifications.allFilterTab).toBeVisible()
    await expect(notifications.unreadFilterTab).toBeVisible()
  })

  test('notifications list or empty state is visible', async ({ page }) => {
    const notifications = new NotificationsPage(page)
    await notifications.goto()

    await expect(notifications.notificationsList.or(notifications.emptyState)).toBeVisible()
  })
})
