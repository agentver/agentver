import type { Locator, Page } from '@playwright/test'

export class CollectionsPage {
  readonly page: Page
  readonly heading: Locator
  readonly createButton: Locator
  readonly collectionsGrid: Locator
  readonly emptyState: Locator
  readonly dialogTitle: Locator
  readonly nameInput: Locator
  readonly descriptionInput: Locator

  constructor(page: Page) {
    this.page = page
    this.heading = page.getByRole('heading', { name: /collections/i })
    this.createButton = page.getByRole('button', { name: /new collection/i })
    this.collectionsGrid = page.locator('main').locator('[class*="grid"]').first()
    this.emptyState = page.getByText(/no collections yet/i)
    this.dialogTitle = page.getByRole('heading', { name: /create collection/i })
    this.nameInput = page.getByLabel(/name/i)
    this.descriptionInput = page.getByLabel(/description/i)
  }

  async goto() {
    await this.page.goto('/collections')
    await this.page.waitForLoadState('domcontentloaded')
  }
}
