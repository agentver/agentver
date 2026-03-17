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

    // The page shows either the org details (with member/package badges)
    // or the "No organisations yet" prompt with a create button
    const hasOrg = await orgs.membersBadge.isVisible().catch(() => false)
    const hasNoOrg = await orgs.noOrgsHeading.isVisible().catch(() => false)

    expect(hasOrg || hasNoOrg).toBe(true)
  })

  test('create organisation button is available when no org exists', async ({ page }) => {
    const orgs = new OrganisationsPage(page)
    await orgs.goto()

    const noOrg = await orgs.noOrgsHeading.isVisible().catch(() => false)
    if (noOrg) {
      await expect(orgs.createButton).toBeVisible()
    }
  })

  test('org switcher section is present in settings sidebar', async ({ page }) => {
    const orgs = new OrganisationsPage(page)
    await orgs.goto()

    // The settings layout includes an OrgSwitcher in the sidebar.
    // It renders either a select trigger, a single org display, or a create button.
    const switcher = page
      .getByRole('combobox')
      .or(page.locator('aside').getByText(/create organisation/i))
      .or(page.locator('aside p.truncate'))

    await expect(switcher.first()).toBeVisible()
  })
})
