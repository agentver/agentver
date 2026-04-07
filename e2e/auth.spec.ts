import { expect, test } from '@playwright/test'
import { SignInPage, SignUpPage } from './pages/auth'

// These tests use a fresh session — no storageState
test.use({ storageState: { cookies: [], origins: [] } })

test.describe('auth', () => {
  test('sign-in page renders with email and password fields', async ({ page }) => {
    const signIn = new SignInPage(page)
    await signIn.goto()
    await expect(signIn.heading).toBeVisible()
    await expect(signIn.emailInput).toBeVisible()
    await expect(signIn.passwordInput).toBeVisible()
    await expect(signIn.submitButton).toBeVisible()
  })

  test('sign-in page has sign-up link', async ({ page }) => {
    const signIn = new SignInPage(page)
    await signIn.goto()
    await expect(signIn.signUpLink).toBeVisible()
    await expect(signIn.signUpLink).toHaveAttribute('href', '/sign-up')
  })

  test('sign-in page has forgot password link', async ({ page }) => {
    const signIn = new SignInPage(page)
    await signIn.goto()
    await expect(signIn.forgotPasswordLink).toBeVisible()
    await expect(signIn.forgotPasswordLink).toHaveAttribute('href', '/forgot-password')
  })

  test('sign-up page renders with name, email, and password fields', async ({ page }) => {
    const signUp = new SignUpPage(page)
    await signUp.goto()
    await expect(signUp.heading).toBeVisible()
    await expect(signUp.nameInput).toBeVisible()
    await expect(signUp.emailInput).toBeVisible()
    await expect(signUp.passwordInput).toBeVisible()
    await expect(signUp.submitButton).toBeVisible()
  })

  test('sign-up page has sign-in link', async ({ page }) => {
    const signUp = new SignUpPage(page)
    await signUp.goto()
    await expect(signUp.signInLink).toBeVisible()
    await expect(signUp.signInLink).toHaveAttribute('href', '/sign-in')
  })

  test('unauthenticated user accessing /dashboard redirects to sign-in', async ({ page }) => {
    await page.goto('/dashboard')
    await expect(page).toHaveURL(/\/sign-in/)
  })

  test('unauthenticated user accessing /skills redirects to sign-in', async ({ page }) => {
    await page.goto('/skills')
    await expect(page).toHaveURL(/\/sign-in/)
  })

  test('sign-in page shows social buttons when providers are enabled', async ({ page }) => {
    await page.route('**/api/auth/providers', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ github: true, google: true }),
      })
    )

    const signIn = new SignInPage(page)
    await signIn.goto()
    await expect(signIn.socialSection).toBeVisible()
    await expect(signIn.githubButton).toBeVisible()
    await expect(signIn.googleButton).toBeVisible()
  })

  test('sign-in page hides social buttons when no providers are configured', async ({ page }) => {
    await page.route('**/api/auth/providers', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ github: false, google: false }),
      })
    )

    const signIn = new SignInPage(page)
    await signIn.goto()
    await expect(signIn.socialSection).not.toBeVisible()
    await expect(signIn.githubButton).not.toBeVisible()
    await expect(signIn.googleButton).not.toBeVisible()
  })

  test('sign-in page displays OAuth error from query params', async ({ page }) => {
    await page.route('**/api/auth/providers', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ github: false, google: false }),
      })
    )

    const signIn = new SignInPage(page)
    await page.goto('/sign-in?error=access_denied')
    await page.waitForLoadState('domcontentloaded')
    await expect(signIn.errorMessage).toBeVisible()
    await expect(signIn.errorMessage).toContainText('You cancelled the sign-in')
  })

  test('sign-up page shows social buttons when providers are enabled', async ({ page }) => {
    await page.route('**/api/auth/providers', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ github: true, google: true }),
      })
    )

    const signUp = new SignUpPage(page)
    await signUp.goto()
    await expect(signUp.socialSection).toBeVisible()
    await expect(signUp.githubButton).toBeVisible()
    await expect(signUp.googleButton).toBeVisible()
  })

  test('sign-up page displays OAuth error from query params', async ({ page }) => {
    await page.route('**/api/auth/providers', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ github: false, google: false }),
      })
    )

    const signUp = new SignUpPage(page)
    await page.goto('/sign-up?error=access_denied')
    await page.waitForLoadState('domcontentloaded')
    await expect(signUp.errorMessage).toBeVisible()
    await expect(signUp.errorMessage).toContainText('You cancelled the sign-up')
  })

  test('sign-up page hides social buttons when no providers are configured', async ({ page }) => {
    await page.route('**/api/auth/providers', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ github: false, google: false }),
      })
    )

    const signUp = new SignUpPage(page)
    await signUp.goto()
    await expect(signUp.socialSection).not.toBeVisible()
  })
})
