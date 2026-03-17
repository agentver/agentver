import { expect, test } from '@playwright/test'
import { ProfilePage } from './pages/profile'

test.describe('profile settings', () => {
  test('profile page renders at /settings/profile', async ({ page }) => {
    const profile = new ProfilePage(page)
    await profile.goto()
    await expect(page).toHaveURL(/\/settings\/profile/)
    await expect(profile.heading).toBeVisible()
  })

  test('account info card is visible', async ({ page }) => {
    const profile = new ProfilePage(page)
    await profile.goto()
    await expect(profile.accountCardTitle).toBeVisible()
    await expect(profile.userName).toBeVisible()
    await expect(profile.userEmail).toBeVisible()
    // Verify the email contains an '@' sign
    await expect(profile.userEmail).toContainText('@')
  })

  test('connected accounts section is visible', async ({ page }) => {
    const profile = new ProfilePage(page)
    await profile.goto()
    await expect(profile.connectedAccountsTitle).toBeVisible()
    await expect(profile.manageConnectionsLink).toBeVisible()
  })

  test('organisations section is visible', async ({ page }) => {
    const profile = new ProfilePage(page)
    await profile.goto()
    await expect(profile.organisationsTitle).toBeVisible()
  })
})
