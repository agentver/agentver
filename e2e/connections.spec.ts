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

  test('each provider card shows a connection status', async ({ page }) => {
    const connections = new ConnectionsPage(page)
    await connections.goto()

    // Each provider card should display a status badge (Connected, Not connected, or Coming soon)
    const providers = [
      connections.githubCard,
      connections.gitlabCard,
      connections.bitbucketCard,
      connections.googleDriveCard,
      connections.oneDriveCard,
    ]

    for (const card of providers) {
      const statusBadge = card.getByText(/connected|not connected|coming soon/i).first()
      await expect(statusBadge).toBeVisible()
    }
  })
})
