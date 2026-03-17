import type { Locator, Page } from '@playwright/test'

export class OrganisationsPage {
  readonly page: Page
  readonly heading: Locator
  readonly description: Locator
  readonly detailsCard: Locator
  readonly orgName: Locator
  readonly orgSlug: Locator
  readonly membersBadge: Locator
  readonly packagesBadge: Locator
  readonly editButton: Locator
  readonly deleteButton: Locator
  readonly createButton: Locator
  readonly noOrgsHeading: Locator
  readonly membersCard: Locator
  readonly skillsRepoCard: Locator

  constructor(page: Page) {
    this.page = page
    this.heading = page.getByRole('heading', { name: /organisation/i, level: 2 })
    this.description = page.getByText(
      /manage your organisation settings, members, and package repository/i
    )
    this.detailsCard = page
      .locator('div.space-y-6 > div')
      .filter({ has: page.locator('img, svg') })
      .first()
    this.orgName = page.locator('[class*="CardTitle"]').first()
    this.orgSlug = page.locator('[class*="CardDescription"]').first()
    this.membersBadge = page.getByText(/member/i).first()
    this.packagesBadge = page.getByText(/package/i).first()
    this.editButton = page.getByRole('button', { name: /edit/i })
    this.deleteButton = page.getByRole('button', { name: /delete/i })
    this.createButton = page.getByRole('button', { name: /create organisation/i })
    this.noOrgsHeading = page.getByRole('heading', { name: /no organisations yet/i })
    this.membersCard = page
      .getByText(/members/i)
      .locator('..')
      .locator('..')
    this.skillsRepoCard = page.getByText(/package repository/i).first()
  }

  async goto() {
    await this.page.goto('/settings/organisation')
    await this.page.waitForLoadState('networkidle')
  }
}
