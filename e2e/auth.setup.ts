import { test as setup } from '@playwright/test'

const authFile = 'playwright/.auth/user.json'

setup('create test user and authenticate', async ({ page }) => {
  const email = process.env.E2E_TEST_EMAIL
  const password = process.env.E2E_TEST_PASSWORD

  if (!email || !password) {
    if (process.env.CI) {
      throw new Error('CI requires E2E_TEST_EMAIL and E2E_TEST_PASSWORD environment variables')
    }
    setup.skip(true, 'E2E_TEST_EMAIL and E2E_TEST_PASSWORD must be set')
    return
  }

  // Create the test user via Better Auth sign-up API (idempotent — ignores if user exists)
  await page.request.post('/api/auth/sign-up/email', {
    data: { email, password, name: 'E2E Test User' },
  })

  // Authenticate via the sign-in form
  await page.goto('/sign-in')
  await page.waitForLoadState('networkidle')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL(/^\/(dashboard)?$/, { timeout: 15_000 })

  // Save the authenticated session state for all tests
  await page.context().storageState({ path: authFile })
})
