import type { Locator, Page } from '@playwright/test'

export class McpPage {
  readonly page: Page
  readonly heading: Locator
  readonly searchInput: Locator
  readonly serverGrid: Locator
  readonly emptyState: Locator
  readonly curatedInfo: Locator

  constructor(page: Page) {
    this.page = page
    this.heading = page.getByRole('heading', { name: /mcp servers/i, level: 1 })
    this.searchInput = page.getByPlaceholder(/search mcp servers/i)
    this.serverGrid = page.locator('main').locator('[class*="grid"]').first()
    this.emptyState = page.getByText(/no mcp servers yet/i)
    this.curatedInfo = page.getByText(/curated catalogue/i)
  }

  async goto() {
    await this.page.goto('/mcp')
    await this.page.waitForLoadState('domcontentloaded')
  }
}
