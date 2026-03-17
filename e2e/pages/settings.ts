import type { Locator, Page } from '@playwright/test'

export class SettingsPage {
  readonly page: Page
  readonly heading: Locator
  readonly profileTab: Locator
  readonly organisationTab: Locator
  readonly teamsTab: Locator
  readonly connectionsTab: Locator
  readonly apiKeysTab: Locator

  constructor(page: Page) {
    this.page = page
    this.heading = page.getByRole('heading', { level: 1 })
    this.profileTab = page.getByRole('link', { name: /profile/i })
    this.organisationTab = page.getByRole('link', { name: /organisation/i })
    this.teamsTab = page.getByRole('link', { name: /teams/i })
    this.connectionsTab = page.getByRole('link', { name: /connections/i })
    this.apiKeysTab = page.getByRole('link', { name: /api keys/i })
  }

  async goto() {
    await this.page.goto('/settings')
    await this.page.waitForLoadState('networkidle')
  }
}
