import { expect, test } from '@playwright/test'
import { BundlesPage } from './pages/bundles'

test.describe('bundles', () => {
  test('bundles page renders with correct heading', async ({ page }) => {
    const bundles = new BundlesPage(page)
    await bundles.goto()
    await expect(page).toHaveURL(/\/bundles/)
    await expect(bundles.heading).toBeVisible()
    await expect(bundles.heading).toHaveText('Bundles')
  })

  test('create bundle button is visible', async ({ page }) => {
    const bundles = new BundlesPage(page)
    await bundles.goto()
    await expect(bundles.createButton).toBeVisible()
  })

  test('bundles grid or empty state is visible', async ({ page }) => {
    const bundles = new BundlesPage(page)
    await bundles.goto()
    await expect(bundles.bundlesGrid.or(bundles.emptyState)).toBeVisible()
  })
})
