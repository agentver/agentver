import type { Locator, Page } from '@playwright/test'

export class SourcesPage {
  readonly page: Page
  readonly heading: Locator
  readonly providerCards: Locator

  constructor(page: Page) {
    this.page = page
    this.heading = page.getByRole('heading', { level: 1 })
    this.providerCards = page.locator('[data-testid="provider-card"]')
  }

  async goto() {
    await this.page.goto('/sources')
    await this.page.waitForLoadState('networkidle')
  }
}
