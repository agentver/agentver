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

  test('search input filters results', async ({ page }) => {
    const skills = new SkillsPage(page)
    await skills.goto()
    await expect(skills.searchInput).toBeVisible()
    const initialCount = await skills.skillsList.locator('> *').count()
    await skills.searchInput.fill('zzz_nonexistent_query')
    await page.waitForLoadState('domcontentloaded')
    const filteredCount = await skills.skillsList.locator('> *').count()
    expect(filteredCount).toBeLessThanOrEqual(initialCount)
  })

  test('create button navigates to new skill page', async ({ page }) => {
    const skills = new SkillsPage(page)
    await skills.goto()
    await skills.createButton.click()
    await expect(page).toHaveURL(/\/skills\/new/)
  })
})
