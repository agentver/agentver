import type { Locator, Page } from '@playwright/test'

export class ConnectionsPage {
  readonly page: Page
  readonly heading: Locator
  readonly providerCards: Locator
  readonly githubCard: Locator
  readonly gitlabCard: Locator
  readonly bitbucketCard: Locator
  readonly googleDriveCard: Locator
  readonly oneDriveCard: Locator
  readonly connectionBadges: Locator

  constructor(page: Page) {
    this.page = page
    this.heading = page.getByRole('heading', { name: /connected accounts/i, level: 1 })
    this.providerCards = page
      .locator('.space-y-4 > div')
      .filter({ has: page.locator('.rounded-lg.border') })
    this.githubCard = page
      .locator('div')
      .filter({ hasText: /^GitHub/ })
      .first()
    this.gitlabCard = page
      .locator('div')
      .filter({ hasText: /^GitLab/ })
      .first()
    this.bitbucketCard = page
      .locator('div')
      .filter({ hasText: /^Bitbucket/ })
      .first()
    this.googleDriveCard = page
      .locator('div')
      .filter({ hasText: /^Google Drive/ })
      .first()
    this.oneDriveCard = page
      .locator('div')
      .filter({ hasText: /^OneDrive/ })
      .first()
    this.connectionBadges = page.getByText(/connected|not connected/i)
  }

  async goto() {
    await this.page.goto('/settings/connections')
    await this.page.waitForLoadState('networkidle')
  }
}
