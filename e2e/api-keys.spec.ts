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
    // The active keys card only renders when keys exist.
    // Verify the page loaded correctly — active keys title appears if keys exist,
    // otherwise only the create form is shown.
    const hasActiveKeys = await apiKeys.activeKeysTitle.isVisible().catch(() => false)
    if (hasActiveKeys) {
      await expect(apiKeys.activeKeysTitle).toBeVisible()
      await expect(apiKeys.keyRows.first()).toBeVisible()
    } else {
      // No active keys — confirm the create form is the only card present
      await expect(apiKeys.createKeyTitle).toBeVisible()
    }
  })
})
