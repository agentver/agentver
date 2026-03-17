import type { Locator, Page } from '@playwright/test'

export class ExplorePage {
  readonly page: Page
  readonly heading: Locator
  readonly searchInput: Locator
  readonly registryTab: Locator
  readonly communityTab: Locator
  readonly mcpServersTab: Locator
  readonly resultsGrid: Locator
  readonly categorySidebar: Locator

  constructor(page: Page) {
    this.page = page
    this.heading = page.getByRole('heading', { name: /explore/i })
    this.searchInput = page.getByPlaceholder(/search/i)
    this.registryTab = page.getByRole('button', { name: /registry/i })
    this.communityTab = page.getByRole('button', { name: /community/i })
    this.mcpServersTab = page.getByRole('button', { name: /mcp servers/i })
    this.resultsGrid = page.locator('main .grid').first()
    this.categorySidebar = page.locator('aside')
  }

  async goto() {
    await this.page.goto('/explore')
    await this.page.waitForLoadState('domcontentloaded')
  }
}
