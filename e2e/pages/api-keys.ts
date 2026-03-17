import type { Locator, Page } from '@playwright/test'

export class ApiKeysPage {
  readonly page: Page
  readonly heading: Locator
  readonly createKeyCard: Locator
  readonly createKeyTitle: Locator
  readonly keyNameInput: Locator
  readonly createKeyButton: Locator
  readonly activeKeysCard: Locator
  readonly activeKeysTitle: Locator
  readonly keyRows: Locator

  constructor(page: Page) {
    this.page = page
    this.heading = page.getByRole('heading', { name: /api keys/i, level: 2 })
    this.createKeyCard = page
      .locator('div')
      .filter({ has: page.getByRole('heading', { name: 'Create API Key' }) })
      .first()
    this.createKeyTitle = page.getByRole('heading', { name: 'Create API Key' })
    this.keyNameInput = page.getByLabel('Key Name')
    this.createKeyButton = page.getByRole('button', { name: /create key/i })
    this.activeKeysCard = page
      .locator('div')
      .filter({ has: page.getByRole('heading', { name: 'Active Keys' }) })
      .first()
    this.activeKeysTitle = page.getByRole('heading', { name: 'Active Keys' })
    this.keyRows = page.locator('.flex.items-center.justify-between.rounded-md.border')
  }

  async goto() {
    await this.page.goto('/settings/api-keys')
    await this.page.waitForLoadState('networkidle')
  }
}
