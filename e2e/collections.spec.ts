import { expect, test } from '@playwright/test'
import { CollectionsPage } from './pages/collections'

test.describe('collections', () => {
  test('collections page renders', async ({ page }) => {
    const collections = new CollectionsPage(page)
    await collections.goto()
    await expect(page).toHaveURL(/\/collections/)
    await expect(collections.heading).toBeVisible()
  })

  test('page heading displays correct text', async ({ page }) => {
    const collections = new CollectionsPage(page)
    await collections.goto()
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
    const hasGrid = await collections.collectionsGrid.first().isVisible()
    const hasEmptyState = await collections.emptyState.isVisible()
    expect(hasGrid || hasEmptyState).toBe(true)
  })
})
