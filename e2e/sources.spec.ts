import { expect, test } from '@playwright/test'
import { authenticateWithBetterAuth, requiresAuth } from './auth/setup'
import { SourcesPage } from './pages/sources'

test.describe('sources', () => {
  test.beforeEach(async ({ page }) => {
    // Skip if auth credentials are not set
    if (!requiresAuth()) {
      test.skip(true, 'Requires E2E_TEST_EMAIL and E2E_TEST_PASSWORD to be set')
    }
    await authenticateWithBetterAuth(page)
  })

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
})
