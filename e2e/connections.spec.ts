import { expect, test } from '@playwright/test'
import { ConnectionsPage } from './pages/connections'

test.describe('connections settings', () => {
  test('connections page renders at /settings/connections', async ({ page }) => {
    const connections = new ConnectionsPage(page)
    await connections.goto()
    await expect(page).toHaveURL(/\/settings\/connections/)
    await expect(connections.heading).toBeVisible()
  })

  test('provider cards are visible', async ({ page }) => {
    const connections = new ConnectionsPage(page)
    await connections.goto()
    await expect(connections.githubCard).toBeVisible()
    await expect(connections.gitlabCard).toBeVisible()
    await expect(connections.bitbucketCard).toBeVisible()
    await expect(connections.googleDriveCard).toBeVisible()
    await expect(connections.oneDriveCard).toBeVisible()
  })

  test('connection status badges render for each provider', async ({ page }) => {
    const connections = new ConnectionsPage(page)
    await connections.goto()
    // Each provider displays either "Connected" or "Not connected" (or "Coming soon")
    // There should be at least 5 status indicators (one per provider)
    const badgeCount = await connections.connectionBadges.count()
    expect(badgeCount).toBeGreaterThanOrEqual(5)
  })
})
