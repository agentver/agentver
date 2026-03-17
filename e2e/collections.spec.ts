import { expect, test } from '@playwright/test'
import { CollectionsPage } from './pages/collections'

test.describe('collections', () => {
  test('collections page renders with correct heading', async ({ page }) => {
    const collections = new CollectionsPage(page)
    await collections.goto()
    await expect(page).toHaveURL(/\/collections/)
    await expect(collections.heading).toBeVisible()
    await expect(collections.heading).toHaveText('Collections')
  })

  test('create collection button opens dialog', async ({ page }) => {
    const collections = new CollectionsPage(page)
    await collections.goto()
    await expect(collections.createButton).toBeVisible()
    await collections.createButton.click()
    await expect(collections.dialogTitle).toBeVisible()
    await expect(collections.nameInput).toBeVisible()
    await expect(collections.descriptionInput).toBeVisible()
  })

  test('collections grid or empty state is visible', async ({ page }) => {
    const collections = new CollectionsPage(page)
    await collections.goto()
    await expect(
      collections.collectionsGrid.or(collections.emptyState)
    ).toBeVisible()
  })
})
