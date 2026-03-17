import { expect, test } from '@playwright/test'
import { authenticateWithBetterAuth, requiresAuth } from './auth/setup'
import { SkillsPage } from './pages/skills'

test.describe('skills', () => {
  test.beforeEach(async ({ page }) => {
    // Skip if auth credentials are not set
    if (!requiresAuth()) {
      test.skip(true, 'Requires E2E_TEST_EMAIL and E2E_TEST_PASSWORD to be set')
    }
    await authenticateWithBetterAuth(page)
  })

  test('skills list page renders', async ({ page }) => {
    const skills = new SkillsPage(page)
    await skills.goto()
    await expect(page).toHaveURL(/\/skills/)
    await expect(skills.heading).toBeVisible()
  })

  test('skills list is visible', async ({ page }) => {
    const skills = new SkillsPage(page)
    await skills.goto()
    await expect(skills.skillsList).toBeVisible()
  })

  test('search input is present', async ({ page }) => {
    const skills = new SkillsPage(page)
    await skills.goto()
    await expect(skills.searchInput).toBeVisible()
  })

  test('search input accepts input', async ({ page }) => {
    const skills = new SkillsPage(page)
    await skills.goto()
    await skills.searchInput.fill('test')
    await expect(skills.searchInput).toHaveValue('test')
  })

  test('create button is present', async ({ page }) => {
    const skills = new SkillsPage(page)
    await skills.goto()
    await expect(skills.createButton).toBeVisible()
  })
})
