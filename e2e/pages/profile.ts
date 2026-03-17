import type { Locator, Page } from '@playwright/test'

export class ProfilePage {
  readonly page: Page
  readonly heading: Locator
  readonly accountCard: Locator
  readonly accountCardTitle: Locator
  readonly userName: Locator
  readonly userEmail: Locator
  readonly connectedAccountsCard: Locator
  readonly connectedAccountsTitle: Locator
  readonly manageConnectionsLink: Locator
  readonly providerRows: Locator
  readonly organisationsCard: Locator
  readonly organisationsTitle: Locator

  constructor(page: Page) {
    this.page = page
    this.heading = page.getByRole('heading', { name: /profile/i, level: 2 })
    this.accountCard = page
      .locator('div')
      .filter({ has: page.getByRole('heading', { name: 'Account' }) })
      .first()
    this.accountCardTitle = page.getByRole('heading', { name: 'Account' })
    this.userName = this.accountCard.locator('p.font-medium.text-lg')
    this.userEmail = this.accountCard.locator('p.text-muted-foreground.text-sm')
    this.connectedAccountsCard = page
      .locator('div')
      .filter({ has: page.getByRole('heading', { name: 'Connected Accounts' }) })
      .first()
    this.connectedAccountsTitle = page.getByRole('heading', { name: 'Connected Accounts' })
    this.manageConnectionsLink = page.getByRole('link', { name: /manage/i }).first()
    this.providerRows = this.connectedAccountsCard.locator(
      '.flex.items-center.justify-between.rounded-md.border'
    )
    this.organisationsCard = page
      .locator('div')
      .filter({ has: page.getByRole('heading', { name: 'Organisations' }) })
      .first()
    this.organisationsTitle = page.getByRole('heading', { name: 'Organisations' })
  }

  async goto() {
    await this.page.goto('/settings/profile')
    await this.page.waitForLoadState('networkidle')
  }
}
