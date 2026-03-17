import { expect, test } from '@playwright/test'
import { ApiKeysPage } from './pages/api-keys'

test.describe('api keys settings', () => {
  test('api keys page renders at /settings/api-keys', async ({ page }) => {
    const apiKeys = new ApiKeysPage(page)
    await apiKeys.goto()
    await expect(page).toHaveURL(/\/settings\/api-keys/)
    await expect(apiKeys.heading).toBeVisible()
  })

  test('create key form has name input and create button', async ({ page }) => {
    const apiKeys = new ApiKeysPage(page)
    await apiKeys.goto()
    await expect(apiKeys.createKeyTitle).toBeVisible()
    await expect(apiKeys.keyNameInput).toBeVisible()
    await expect(apiKeys.createKeyButton).toBeVisible()
  })

  test('active keys section renders', async ({ page }) => {
    const apiKeys = new ApiKeysPage(page)
    await apiKeys.goto()

    await expect(apiKeys.activeKeysCard.or(apiKeys.createKeyCard)).toBeVisible()
  })
})
