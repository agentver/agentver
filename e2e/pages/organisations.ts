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
  readonly orgSwitcher: Locator

  constructor(page: Page) {
    this.page = page
    this.heading = page.getByRole('heading', { name: /organisation/i, level: 2 })
    this.description = page.getByText(
      /manage your organisation settings, members, and package repository/i
    )
    this.detailsCard = page
      .locator('section, div')
      .filter({ has: page.getByRole('heading', { name: /organisation/i }) })
      .first()
    this.orgName = this.detailsCard.getByRole('heading').first()
    this.orgSlug = this.detailsCard.getByText(/^@/).first()
    this.membersBadge = page.getByText(/member/i).first()
    this.packagesBadge = page.getByText(/package/i).first()
    this.editButton = page.getByRole('button', { name: /edit/i })
    this.deleteButton = page.getByRole('button', { name: /delete/i })
    this.createButton = page.getByRole('button', { name: /create organisation/i })
    this.noOrgsHeading = page.getByRole('heading', { name: /no organisations yet/i })
    this.membersCard = page
      .locator('section, div')
      .filter({ has: page.getByRole('heading', { name: /members/i }) })
      .first()
    this.skillsRepoCard = page.getByText(/package repository/i).first()
    this.orgSwitcher = page
      .getByRole('combobox')
      .or(page.locator('aside').getByText(/create organisation/i))
      .or(page.locator('aside p.truncate'))
  }

  async goto() {
    await this.page.goto('/settings/organisation')
    await this.page.waitForLoadState('domcontentloaded')
  }
}
