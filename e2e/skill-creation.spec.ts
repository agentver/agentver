import { expect, test } from '@playwright/test'
import { SkillCreatePage } from './pages/skill-create'

/**
 * Wait for the skill creation page to settle into a stable state.
 * During tRPC query loading, the page briefly renders editor tabs
 * before switching to GitHub-required or no-repo states.
 */
async function waitForStableState(skillCreate: SkillCreatePage) {
  const stableIndicator = skillCreate.editorTab
    .or(skillCreate.githubRequiredHeading)
    .or(skillCreate.noRepoHeading)

  // Wait for any known state to appear, then give it a moment to settle
  await expect(stableIndicator).toBeVisible({ timeout: 10_000 })
  // Allow re-render after tRPC queries resolve
  await skillCreate.page.waitForLoadState('networkidle')
}

/**
 * Check if GitHub is connected (editor/upload tabs available).
 * Skips the test with annotation if not.
 */
async function requireGitHubConnection(
  skillCreate: SkillCreatePage,
  testInfo: import('@playwright/test').TestInfo
): Promise<void> {
  await waitForStableState(skillCreate)

  const hasEditorTab = await skillCreate.editorTab.isVisible().catch(() => false)
  if (!hasEditorTab) {
    testInfo.annotations.push({
      type: 'skip',
      description:
        'GitHub account not connected — editor/upload tabs are unavailable. Connect GitHub in CI or test environment to enable this test.',
    })
    test.skip(true, 'Requires GitHub connection: editor/upload tabs not rendered without it')
  }
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

    await waitForStableState(skillCreate)

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

    const renderedExpectedState = hasGitHub || showsGitHubRequired || showsNoRepo
    expect(
      renderedExpectedState,
      'Expected either editor tabs (GitHub connected) or a GitHub-required / no-repo heading (GitHub not connected)'
    ).toBe(true)
  })

  test('editor tab is visible and active by default', async ({ page }, testInfo) => {
    const skillCreate = new SkillCreatePage(page)
    await skillCreate.goto()

    await requireGitHubConnection(skillCreate, testInfo)

    await expect(skillCreate.editorTab).toHaveAttribute('aria-selected', 'true')
  })

  test('upload tab is accessible', async ({ page }, testInfo) => {
    const skillCreate = new SkillCreatePage(page)
    await skillCreate.goto()

    await requireGitHubConnection(skillCreate, testInfo)

    await skillCreate.uploadTab.click()
    await expect(skillCreate.uploadTab).toHaveAttribute('aria-selected', 'true')
    await expect(skillCreate.dropzone).toBeVisible()
  })

  test('form fields render in editor tab', async ({ page }, testInfo) => {
    const skillCreate = new SkillCreatePage(page)
    await skillCreate.goto()

    await requireGitHubConnection(skillCreate, testInfo)

    await expect(skillCreate.nameInput).toBeVisible()
    await expect(skillCreate.descriptionInput).toBeVisible()
    await expect(skillCreate.commitMessageInput).toBeVisible()
    await expect(skillCreate.tagsInput).toBeVisible()
  })
})
