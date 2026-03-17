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

    const hasEditor = await skillCreate.editorTab.isVisible().catch(() => false)
    test.skip(!hasEditor, 'Editor only available when GitHub is connected')

    await expect(skillCreate.editorTab).toHaveAttribute('aria-selected', 'true')
  })

  test('upload tab is accessible', async ({ page }) => {
    const skillCreate = new SkillCreatePage(page)
    await skillCreate.goto()

    const hasUpload = await skillCreate.uploadTab.isVisible().catch(() => false)
    test.skip(!hasUpload, 'Upload tab only available when GitHub is connected')

    await skillCreate.uploadTab.click()
    await expect(skillCreate.uploadTab).toHaveAttribute('aria-selected', 'true')
    await expect(skillCreate.dropzone).toBeVisible()
  })

  test('form fields render in editor tab', async ({ page }) => {
    const skillCreate = new SkillCreatePage(page)
    await skillCreate.goto()

    const hasEditor = await skillCreate.editorTab.isVisible().catch(() => false)
    test.skip(!hasEditor, 'Editor only available when GitHub is connected')

    await expect(skillCreate.nameInput).toBeVisible()
    await expect(skillCreate.descriptionInput).toBeVisible()
    await expect(skillCreate.commitMessageInput).toBeVisible()
    await expect(skillCreate.tagsInput).toBeVisible()
  })
})
