import type { Locator, Page } from '@playwright/test'

export class NotificationsPage {
  readonly page: Page
  readonly heading: Locator
  readonly markAllReadButton: Locator
  readonly allFilterTab: Locator
  readonly unreadFilterTab: Locator
  readonly notificationsList: Locator
  readonly emptyState: Locator

  constructor(page: Page) {
    this.page = page
    this.heading = page.getByRole('heading', { name: /notifications/i })
    this.markAllReadButton = page.getByRole('button', { name: /mark all as read/i })
    this.allFilterTab = page.getByRole('button', { name: /^all$/i })
    this.unreadFilterTab = page.getByRole('button', { name: /^unread$/i })
    this.notificationsList = page.locator('main').locator('ul, [role="list"]').first()
    this.emptyState = page.getByText(/you're all caught up/i)
  }

  async goto() {
    await this.page.goto('/notifications')
    await this.page.waitForLoadState('domcontentloaded')
  }
}
