import type { Locator, Page } from '@playwright/test'

export class DashboardPage {
  readonly page: Page
  readonly heading: Locator
  readonly statCards: Locator
  readonly recentPackages: Locator
  readonly recentActivity: Locator

  constructor(page: Page) {
    this.page = page
    this.heading = page.getByRole('heading', { level: 1 })
    this.statCards = page.locator('[data-testid="stat-card"]')
    this.recentPackages = page.locator('[data-testid="recent-packages"]')
    this.recentActivity = page.locator('[data-testid="recent-activity"]')
  }

  async goto() {
    await this.page.goto('/dashboard')
  }
}
