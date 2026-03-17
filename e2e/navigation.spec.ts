import { expect, test } from '@playwright/test'
import { authenticateWithBetterAuth, requiresAuth } from './auth/setup'
import { DashboardPage } from './pages/dashboard'
import { SettingsPage } from './pages/settings'
import { SkillsPage } from './pages/skills'
import { SourcesPage } from './pages/sources'

test.describe('navigation', () => {
  test('home page loads', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveURL(/.*/)
    await expect(page.locator('body')).toBeVisible()
  })

  test('sign-in page loads', async ({ page }) => {
    await page.goto('/sign-in')
    await expect(page.locator('body')).toBeVisible()
  })

  test.describe('authenticated navigation', () => {
    test.beforeEach(async ({ page }) => {
      // Skip if auth credentials are not set
      if (!requiresAuth()) {
        test.skip(true, 'Requires E2E_TEST_EMAIL and E2E_TEST_PASSWORD to be set')
      }
      await authenticateWithBetterAuth(page)
    })

    test('navigates to dashboard', async ({ page }) => {
      const dashboard = new DashboardPage(page)
      await dashboard.goto()
      await expect(page).toHaveURL(/\/dashboard/)
      await expect(dashboard.heading).toBeVisible()
    })

    test('navigates to skills', async ({ page }) => {
      const skills = new SkillsPage(page)
      await skills.goto()
      await expect(page).toHaveURL(/\/skills/)
      await expect(skills.heading).toBeVisible()
    })

    test('navigates to settings', async ({ page }) => {
      const settings = new SettingsPage(page)
      await settings.goto()
      await expect(page).toHaveURL(/\/settings/)
      await expect(settings.heading).toBeVisible()
    })

    test('navigates to sources', async ({ page }) => {
      const sources = new SourcesPage(page)
      await sources.goto()
      await expect(page).toHaveURL(/\/sources/)
      await expect(sources.heading).toBeVisible()
    })
  })
})
