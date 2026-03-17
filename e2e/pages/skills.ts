import type { Locator, Page } from '@playwright/test'

export class SkillsPage {
  readonly page: Page
  readonly heading: Locator
  readonly skillsList: Locator
  readonly searchInput: Locator
  readonly typeFilter: Locator
  readonly createButton: Locator

  constructor(page: Page) {
    this.page = page
    this.heading = page.getByRole('heading', { level: 1 })
    this.skillsList = page.locator('[data-testid="skills-list"]')
    this.searchInput = page.getByPlaceholder(/search/i)
    this.typeFilter = page.locator('[data-testid="type-filter"]')
    this.createButton = page.getByRole('button', { name: /create/i })
  }

  async goto() {
    await this.page.goto('/skills')
  }
}
