import type { Locator, Page } from '@playwright/test'

export class BundlesPage {
  readonly page: Page
  readonly heading: Locator
  readonly createButton: Locator
  readonly bundlesGrid: Locator
  readonly emptyState: Locator

  constructor(page: Page) {
    this.page = page
    this.heading = page.getByRole('heading', { name: /bundles/i })
    this.createButton = page.getByRole('link', { name: /create bundle/i })
    this.bundlesGrid = page.locator('.grid')
    this.emptyState = page.getByText(/no bundles yet/i)
  }

  async goto() {
    await this.page.goto('/bundles')
    await this.page.waitForLoadState('networkidle')
  }
}
