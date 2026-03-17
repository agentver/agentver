import { expect, test } from '@playwright/test'
import { SkillCreatePage } from './pages/skill-create'

/**
 * Helper to check GitHub connection state and skip with visible annotations.
 * Returns true if GitHub is connected (editor/upload tabs are available).
 */
async function requireGitHubConnection(
  page: import('@playwright/test').Page,
  testInfo: import('@playwright/test').TestInfo,
  locator: import('@playwright/test').Locator,
): Promise<boolean> {
  const isVisible = await locator.isVisible().catch(() => false)
  if (!isVisible) {
    testInfo.annotations.push({
      type: 'skip',
      description:
        'GitHub account not connected — editor/upload tabs are unavailable. Connect GitHub in CI or test environment to enable this test.',
    })
    test.skip(true, 'Requires GitHub connection: editor/upload tabs not rendered without it')
  }
  return true
}

test.describe('skill creation', () => {
  test('new skill page renders', async ({ page }) => {
    const skillCreate = new SkillCreatePage(page)
    await skillCreate.goto()
    await expect(page).toHaveURL(/\/skills\/new/)
    await expect(skillCreate.heading).toBeVisible()
  })

  test('page description is visible', async ({ page }) => {
    const skillCreate = new SkillCreatePage(page)
    await skillCreate.goto()
    await expect(skillCreate.description).toBeVisible()
  })

  test('GitHub connection state is detectable', async ({ page }) => {
    const skillCreate = new SkillCreatePage(page)
    await skillCreate.goto()

    const hasGitHub = await skillCreate.editorTab.isVisible().catch(() => false)
    const showsGitHubRequired = await skillCreate.githubRequiredHeading
      .isVisible()
      .catch(() => false)
    const showsNoRepo = await skillCreate.noRepoHeading.isVisible().catch(() => false)

    if (!hasGitHub) {
      test.info().annotations.push({
        type: 'warning',
        description:
          'GitHub is NOT connected in this environment. Tests requiring editor/upload tabs will be skipped. To run the full suite, ensure the test user has a connected GitHub account.',
      })
    }

    // The page must show either the editor tabs (GitHub connected) or a
    // GitHub-required / no-repo heading (GitHub not connected). This ensures
    // the page rendered correctly regardless of connection state.
    const renderedExpectedState = hasGitHub || showsGitHubRequired || showsNoRepo
    expect(
      renderedExpectedState,
      'Expected either editor tabs (GitHub connected) or a GitHub-required / no-repo heading (GitHub not connected)',
    ).toBe(true)
  })

  test('editor tab is visible and active by default', async ({ page }, testInfo) => {
    const skillCreate = new SkillCreatePage(page)
    await skillCreate.goto()

    await requireGitHubConnection(page, testInfo, skillCreate.editorTab)

    await expect(skillCreate.editorTab).toHaveAttribute('aria-selected', 'true')
  })

  test('upload tab is accessible', async ({ page }, testInfo) => {
    const skillCreate = new SkillCreatePage(page)
    await skillCreate.goto()

    await requireGitHubConnection(page, testInfo, skillCreate.uploadTab)

    await skillCreate.uploadTab.click()
    await expect(skillCreate.uploadTab).toHaveAttribute('aria-selected', 'true')
    await expect(skillCreate.dropzone).toBeVisible()
  })

  test('form fields render in editor tab', async ({ page }, testInfo) => {
    const skillCreate = new SkillCreatePage(page)
    await skillCreate.goto()

    await requireGitHubConnection(page, testInfo, skillCreate.editorTab)

    await expect(skillCreate.nameInput).toBeVisible()
    await expect(skillCreate.descriptionInput).toBeVisible()
    await expect(skillCreate.commitMessageInput).toBeVisible()
    await expect(skillCreate.tagsInput).toBeVisible()
  })
})
