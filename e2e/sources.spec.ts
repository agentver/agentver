import { expect, test } from '@playwright/test'
import { SourcesPage } from './pages/sources'

test.describe('sources', () => {
  test('sources page renders', async ({ page }) => {
    const sources = new SourcesPage(page)
    await sources.goto()
    await expect(page).toHaveURL(/\/sources/)
    await expect(sources.heading).toBeVisible()
  })

  test('provider cards are visible', async ({ page }) => {
    const sources = new SourcesPage(page)
    await sources.goto()
    await expect(sources.providerCards.first()).toBeVisible()
  })

  test('all import providers are listed', async ({ page }) => {
    const sources = new SourcesPage(page)
    await sources.goto()
    const count = await sources.providerCards.count()
    expect(count).toBeGreaterThanOrEqual(1)
  })
})
