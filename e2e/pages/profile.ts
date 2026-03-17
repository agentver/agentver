import type { Locator, Page } from '@playwright/test'

export class ProfilePage {
  readonly page: Page
  readonly heading: Locator
  readonly accountCardTitle: Locator
  readonly userName: Locator
  readonly userEmail: Locator
  readonly connectedAccountsTitle: Locator
  readonly manageConnectionsLink: Locator
  readonly providerNames: Locator
  readonly organisationsTitle: Locator

  constructor(page: Page) {
    this.page = page
    this.heading = page.getByRole('heading', { name: /profile/i, level: 2 })

    // Account section — locate by card title text
    this.accountCardTitle = page.getByText('Account', { exact: true }).first()
    // User name and email are the two <p> tags next to the avatar
    // The name is inside a div alongside the avatar, scoped by the profile page content
    this.userName = page.locator('p').filter({ hasText: /\S/ }).first()
    this.userEmail = page.locator('p').filter({ hasText: /@/ }).first()

    // Connected accounts section
    this.connectedAccountsTitle = page.getByText('Connected Accounts', { exact: true }).first()
    this.manageConnectionsLink = page.getByRole('link', { name: /manage/i }).first()

    // Provider name paragraphs within the connected accounts area (GitHub, GitLab, etc.)
    this.providerNames = page.locator('img[alt="GitHub"], img[alt="GitLab"], img[alt="Bitbucket"], img[alt="Google Drive"], img[alt="OneDrive"]')

    // Organisations section
    this.organisationsTitle = page.getByText('Organisations', { exact: true }).first()
  }

  async goto() {
    await this.page.goto('/settings/profile')
    await this.page.waitForLoadState('domcontentloaded')
  }
}
