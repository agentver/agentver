import { expect, test } from '@playwright/test'
import { SkillsPage } from './pages/skills'

test.describe('skills', () => {
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

  test('search input is present and accepts input', async ({ page }) => {
    const skills = new SkillsPage(page)
    await skills.goto()
    await expect(skills.searchInput).toBeVisible()
    await skills.searchInput.fill('test')
    await expect(skills.searchInput).toHaveValue('test')
  })

  test('create button is present', async ({ page }) => {
    const skills = new SkillsPage(page)
    await skills.goto()
    await expect(skills.createButton).toBeVisible()
  })

  test('create button navigates to new skill page', async ({ page }) => {
    const skills = new SkillsPage(page)
    await skills.goto()
    await skills.createButton.click()
    await expect(page).toHaveURL(/\/skills\/new/)
  })
})
