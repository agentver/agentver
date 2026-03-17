import type { Locator, Page } from '@playwright/test'

export class SignInPage {
  readonly page: Page
  readonly heading: Locator
  readonly emailInput: Locator
  readonly passwordInput: Locator
  readonly submitButton: Locator
  readonly signUpLink: Locator
  readonly githubButton: Locator
  readonly googleButton: Locator
  readonly errorMessage: Locator

  constructor(page: Page) {
    this.page = page
    this.heading = page.getByRole('heading', { name: /sign in/i })
    this.emailInput = page.getByLabel('Email')
    this.passwordInput = page.getByLabel('Password')
    this.submitButton = page.getByRole('button', { name: /sign in/i })
    this.signUpLink = page.getByRole('link', { name: /sign up/i })
    this.githubButton = page.getByRole('button', { name: /github/i })
    this.googleButton = page.getByRole('button', { name: /google/i })
    this.errorMessage = page.getByRole('alert')
  }

  async goto() {
    await this.page.goto('/sign-in')
    await this.page.waitForLoadState('domcontentloaded')
  }
}

export class SignUpPage {
  readonly page: Page
  readonly heading: Locator
  readonly nameInput: Locator
  readonly emailInput: Locator
  readonly passwordInput: Locator
  readonly submitButton: Locator
  readonly signInLink: Locator
  readonly githubButton: Locator
  readonly googleButton: Locator
  readonly errorMessage: Locator

  constructor(page: Page) {
    this.page = page
    this.heading = page.getByRole('heading', { name: /create your account/i })
    this.nameInput = page.getByLabel('Name')
    this.emailInput = page.getByLabel('Email')
    this.passwordInput = page.getByLabel('Password')
    this.submitButton = page.getByRole('button', { name: /sign up/i })
    this.signInLink = page.getByRole('link', { name: /sign in/i })
    this.githubButton = page.getByRole('button', { name: /github/i })
    this.googleButton = page.getByRole('button', { name: /google/i })
    this.errorMessage = page.getByRole('alert')
  }

  async goto() {
    await this.page.goto('/sign-up')
    await this.page.waitForLoadState('domcontentloaded')
  }
}
