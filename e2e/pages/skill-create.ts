import type { Locator, Page } from '@playwright/test'

export class SkillCreatePage {
  readonly page: Page
  readonly heading: Locator
  readonly description: Locator
  readonly editorTab: Locator
  readonly uploadTab: Locator
  readonly nameInput: Locator
  readonly descriptionInput: Locator
  readonly tagsInput: Locator
  readonly addTagButton: Locator
  readonly commitMessageInput: Locator
  readonly commitSaveButton: Locator
  readonly editModeButton: Locator
  readonly previewModeButton: Locator
  readonly dropzone: Locator
  readonly githubRequiredHeading: Locator
  readonly noRepoHeading: Locator
  readonly goToSettingsLink: Locator

  constructor(page: Page) {
    this.page = page
    this.heading = page.getByRole('heading', { name: /create package/i, level: 2 })
    this.description = page.getByText(/a skill is a set of instructions/i)
    this.editorTab = page.getByRole('tab', { name: /editor/i })
    this.uploadTab = page.getByRole('tab', { name: /upload/i })
    this.nameInput = page.getByLabel(/^name$/i)
    this.descriptionInput = page.getByLabel(/^description$/i)
    this.tagsInput = page.getByPlaceholder(/add tag/i)
    this.addTagButton = page.getByRole('button', { name: /^add$/i })
    this.commitMessageInput = page.getByLabel(/commit message/i)
    this.commitSaveButton = page.getByRole('button', { name: /commit & save/i })
    this.editModeButton = page.getByRole('button', { name: /edit/i }).first()
    this.previewModeButton = page.getByRole('button', { name: /preview/i })
    this.dropzone = page.getByText(/drop skill\.md files here/i)
    this.githubRequiredHeading = page.getByRole('heading', { name: /github account required/i })
    this.noRepoHeading = page.getByRole('heading', { name: /no package repository connected/i })
    this.goToSettingsLink = page.getByRole('link', { name: /go to settings/i })
  }

  async goto() {
    await this.page.goto('/skills/new')
    await this.page.waitForLoadState('domcontentloaded')
  }
}
