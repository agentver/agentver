import type { Locator, Page } from '@playwright/test'

export class TeamsPage {
  readonly page: Page
  readonly heading: Locator
  readonly createTeamButton: Locator
  readonly createTeamDialog: Locator
  readonly teamNameInput: Locator
  readonly teamSlugInput: Locator
  readonly submitCreateButton: Locator
  readonly teamCards: Locator
  readonly emptyState: Locator

  constructor(page: Page) {
    this.page = page
    this.heading = page.getByRole('heading', { name: /teams/i, level: 2 })
    this.createTeamButton = page.getByRole('button', { name: /create team/i })
    this.createTeamDialog = page.getByRole('dialog')
    this.teamNameInput = page.getByLabel('Name')
    this.teamSlugInput = page.getByLabel('Slug')
    this.submitCreateButton = this.createTeamDialog.getByRole('button', { name: /create team/i })
    this.teamCards = page.locator('.grid .cursor-pointer')
    this.emptyState = page.getByText(/no teams yet/i)
  }

  async goto() {
    await this.page.goto('/settings/teams')
    await this.page.waitForLoadState('networkidle')
  }

  async openCreateDialog() {
    await this.createTeamButton.click()
  }
}
