import { expect, test } from '@playwright/test'
import { authenticateWithBetterAuth, requiresAuth } from './auth/setup'
import { SettingsPage } from './pages/settings'

test.describe('settings', () => {
  test.beforeEach(async ({ page }) => {
    // Skip if auth credentials are not set
    if (!requiresAuth()) {
      test.skip(true, 'Requires E2E_TEST_EMAIL and E2E_TEST_PASSWORD to be set')
    }
    await authenticateWithBetterAuth(page)
  })

  test('settings page renders', async ({ page }) => {
    const settings = new SettingsPage(page)
    await settings.goto()
    await expect(page).toHaveURL(/\/settings/)
    await expect(settings.heading).toBeVisible()
  })

  test('profile tab is accessible', async ({ page }) => {
    const settings = new SettingsPage(page)
    await settings.goto()
    await expect(settings.profileTab).toBeVisible()
    await settings.profileTab.click()
    await expect(page).toHaveURL(/\/settings\/profile/)
  })

  test('organisation tab is accessible', async ({ page }) => {
    const settings = new SettingsPage(page)
    await settings.goto()
    await expect(settings.organisationTab).toBeVisible()
    await settings.organisationTab.click()
    await expect(page).toHaveURL(/\/settings\/organisation/)
  })

  test('teams tab is accessible', async ({ page }) => {
    const settings = new SettingsPage(page)
    await settings.goto()
    await expect(settings.teamsTab).toBeVisible()
    await settings.teamsTab.click()
    await expect(page).toHaveURL(/\/settings\/teams/)
  })

  test('connections tab is accessible', async ({ page }) => {
    const settings = new SettingsPage(page)
    await settings.goto()
    await expect(settings.connectionsTab).toBeVisible()
    await settings.connectionsTab.click()
    await expect(page).toHaveURL(/\/settings\/connections/)
  })

  test('api keys tab is accessible', async ({ page }) => {
    const settings = new SettingsPage(page)
    await settings.goto()
    await expect(settings.apiKeysTab).toBeVisible()
    await settings.apiKeysTab.click()
    await expect(page).toHaveURL(/\/settings\/api-keys/)
  })
})
