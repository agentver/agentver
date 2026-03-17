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
    this.createKeyTitle = page.getByRole('heading', { name: 'Create API Key' })
    this.createKeyCard = page.locator('section, div').filter({ has: this.createKeyTitle }).first()
    this.keyNameInput = page.getByLabel('Key Name')
    this.createKeyButton = page.getByRole('button', { name: /create key/i })
    this.activeKeysTitle = page.getByRole('heading', { name: 'Active Keys' })
    this.activeKeysCard = page.locator('section, div').filter({ has: this.activeKeysTitle }).first()
    this.keyRows = this.activeKeysCard.locator('li, [role="listitem"], > div > div').filter({
      has: page.getByRole('button', { name: /revoke|delete|remove/i }),
    })
  }

  async goto() {
    await this.page.goto('/settings/api-keys')
    await this.page.waitForLoadState('domcontentloaded')
  }
}
