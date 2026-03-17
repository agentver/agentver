import { expect, test } from '@playwright/test'
import { DashboardPage } from './pages/dashboard'
import { SettingsPage } from './pages/settings'
import { SkillsPage } from './pages/skills'
import { SourcesPage } from './pages/sources'

test.describe('navigation', () => {
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
