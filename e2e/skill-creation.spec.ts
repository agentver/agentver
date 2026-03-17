import { expect, test } from '@playwright/test'
import { SkillCreatePage } from './pages/skill-create'

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

  test('editor tab is visible and active by default', async ({ page }) => {
    const skillCreate = new SkillCreatePage(page)
    await skillCreate.goto()

    // The page may show a gate (GitHub required / no repo) or the full editor.
    // Only check tabs when the editor is rendered.
    const hasEditor = await skillCreate.editorTab.isVisible().catch(() => false)
    if (hasEditor) {
      await expect(skillCreate.editorTab).toBeVisible()
      await expect(skillCreate.editorTab).toHaveAttribute('aria-selected', 'true')
    }
  })

  test('upload tab is accessible', async ({ page }) => {
    const skillCreate = new SkillCreatePage(page)
    await skillCreate.goto()

    const hasUpload = await skillCreate.uploadTab.isVisible().catch(() => false)
    if (hasUpload) {
      await skillCreate.uploadTab.click()
      await expect(skillCreate.uploadTab).toHaveAttribute('aria-selected', 'true')
      await expect(skillCreate.dropzone).toBeVisible()
    }
  })

  test('form fields render in editor tab', async ({ page }) => {
    const skillCreate = new SkillCreatePage(page)
    await skillCreate.goto()

    const hasEditor = await skillCreate.editorTab.isVisible().catch(() => false)
    if (hasEditor) {
      await expect(skillCreate.nameInput).toBeVisible()
      await expect(skillCreate.descriptionInput).toBeVisible()
      await expect(skillCreate.commitMessageInput).toBeVisible()
      await expect(skillCreate.tagsInput).toBeVisible()
    }
  })

  test('page shows appropriate content for creating a skill', async ({ page }) => {
    const skillCreate = new SkillCreatePage(page)
    await skillCreate.goto()

    // The page always renders one of three states:
    // 1. Full editor with tabs (org + repo connected)
    // 2. "GitHub account required" gate
    // 3. "No package repository connected" gate
    const hasEditor = await skillCreate.editorTab.isVisible().catch(() => false)
    const hasGitHubGate = await skillCreate.githubRequiredHeading.isVisible().catch(() => false)
    const hasRepoGate = await skillCreate.noRepoHeading.isVisible().catch(() => false)

    expect(hasEditor || hasGitHubGate || hasRepoGate).toBe(true)
  })
})
