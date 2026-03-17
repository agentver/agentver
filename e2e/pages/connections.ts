import type { Locator, Page } from '@playwright/test'

export class ConnectionsPage {
  readonly page: Page
  readonly heading: Locator
  readonly mainContent: Locator
  readonly githubCard: Locator
  readonly gitlabCard: Locator
  readonly bitbucketCard: Locator
  readonly googleDriveCard: Locator
  readonly oneDriveCard: Locator

  constructor(page: Page) {
    this.page = page
    this.heading = page.getByRole('heading', { name: /connected accounts/i, level: 1 })

    // Scope all card locators to the main content area (the page wrapper div)
    this.mainContent = page.locator('main')

    // Each provider is rendered as a <Card> component — find by the provider name text within the card title
    this.githubCard = this.mainContent.locator('div').filter({ hasText: /^GitHub/ }).first()
    this.gitlabCard = this.mainContent.locator('div').filter({ hasText: /^GitLab/ }).first()
    this.bitbucketCard = this.mainContent.locator('div').filter({ hasText: /^Bitbucket/ }).first()
    this.googleDriveCard = this.mainContent.locator('div').filter({ hasText: /^Google Drive/ }).first()
    this.oneDriveCard = this.mainContent.locator('div').filter({ hasText: /^OneDrive/ }).first()
  }

  /** Get the connection status badge text for a specific provider card */
  async getProviderStatus(providerCard: Locator): Promise<string> {
    const badge = providerCard.getByText(/connected|not connected|coming soon/i).first()
    return badge.innerText()
  }

  async goto() {
    await this.page.goto('/settings/connections')
    await this.page.waitForLoadState('domcontentloaded')
  }
}
