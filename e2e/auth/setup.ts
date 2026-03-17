import type { Page } from '@playwright/test'

export async function authenticateWithBetterAuth(page: Page) {
  const email = process.env.E2E_TEST_EMAIL
  const password = process.env.E2E_TEST_PASSWORD

  if (!email || !password) {
    throw new Error('E2E_TEST_EMAIL and E2E_TEST_PASSWORD must be set')
  }

  await page.goto('/sign-in')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL('/')
}

export function requiresAuth(): boolean {
  return !!(process.env.E2E_TEST_EMAIL && process.env.E2E_TEST_PASSWORD)
}
