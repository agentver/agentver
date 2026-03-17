import { expect, test } from '@playwright/test'
import { DashboardPage } from './pages/dashboard'

test.describe('dashboard', () => {
  test('dashboard page renders with heading', async ({ page }) => {
    const dashboard = new DashboardPage(page)
    await dashboard.goto()
    await expect(page).toHaveURL(/\/dashboard/)
    await expect(dashboard.heading).toBeVisible()
  })

  test('stats cards are visible', async ({ page }) => {
    const dashboard = new DashboardPage(page)
    await dashboard.goto()
    await expect(dashboard.statCards.first()).toBeVisible()
  })

  test('quick action buttons render', async ({ page }) => {
    const dashboard = new DashboardPage(page)
    await dashboard.goto()
    await expect(dashboard.quickActions).toBeVisible()
  })

  test('recent packages section renders', async ({ page }) => {
    const dashboard = new DashboardPage(page)
    await dashboard.goto()
    await expect(dashboard.recentPackages).toBeVisible()
  })

  test('recent activity section renders', async ({ page }) => {
    const dashboard = new DashboardPage(page)
    await dashboard.goto()
    await expect(dashboard.recentActivity).toBeVisible()
  })
})
