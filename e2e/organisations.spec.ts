import { expect, test } from '@playwright/test'
import { OrganisationsPage } from './pages/organisations'

test.describe('organisation settings', () => {
  test('organisation settings page renders', async ({ page }) => {
    const orgs = new OrganisationsPage(page)
    await orgs.goto()
    await expect(page).toHaveURL(/\/settings\/organisation/)
    await expect(orgs.heading).toBeVisible()
  })

  test('page description is visible', async ({ page }) => {
    const orgs = new OrganisationsPage(page)
    await orgs.goto()
    await expect(orgs.description).toBeVisible()
  })

  test('organisation details or create prompt is shown', async ({ page }) => {
    const orgs = new OrganisationsPage(page)
    await orgs.goto()

    await expect(orgs.membersBadge.or(orgs.noOrgsHeading)).toBeVisible()
  })

  test('create organisation button is available when no org exists', async ({ page }) => {
    const orgs = new OrganisationsPage(page)
    await orgs.goto()

    const hasOrg = await orgs.membersBadge.isVisible().catch(() => false)
    test.skip(hasOrg, 'Organisation already exists — skipping create button check')

    await expect(orgs.createButton).toBeVisible()
  })

  test('org switcher section is present in settings sidebar', async ({ page }) => {
    const orgs = new OrganisationsPage(page)
    await orgs.goto()

    await expect(orgs.orgSwitcher.first()).toBeVisible()
  })
})
