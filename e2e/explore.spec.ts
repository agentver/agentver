import { expect, test } from '@playwright/test'
import { ExplorePage } from './pages/explore'

test.describe('explore', () => {
  test('explore page renders with heading', async ({ page }) => {
    const explore = new ExplorePage(page)
    await explore.goto()
    await expect(page).toHaveURL(/\/explore/)
    await expect(explore.heading).toBeVisible()
  })

  test('search bar is visible', async ({ page }) => {
    const explore = new ExplorePage(page)
    await explore.goto()
    await expect(explore.searchInput).toBeVisible()
  })

  test('source tabs are visible and navigable', async ({ page }) => {
    const explore = new ExplorePage(page)
    await explore.goto()
    await expect(explore.registryTab).toBeVisible()
    await expect(explore.communityTab).toBeVisible()
    await expect(explore.mcpServersTab).toBeVisible()
  })

  test('switching to community tab updates results', async ({ page }) => {
    const explore = new ExplorePage(page)
    await explore.goto()
    await explore.communityTab.click()
    await page.waitForLoadState('domcontentloaded')
    await expect(explore.communityTab).toHaveAttribute('aria-selected', 'true')
  })

  test('switching to mcp servers tab updates results', async ({ page }) => {
    const explore = new ExplorePage(page)
    await explore.goto()
    await explore.mcpServersTab.click()
    await page.waitForLoadState('domcontentloaded')
    await expect(explore.mcpServersTab).toHaveAttribute('aria-selected', 'true')
  })

  test('results grid renders', async ({ page }) => {
    const explore = new ExplorePage(page)
    await explore.goto()
    await expect(explore.resultsGrid.first()).toBeVisible()
  })
})
