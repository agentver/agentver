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
})
