import { expect, test } from '@playwright/test'
import { TeamsPage } from './pages/teams'

test.describe('teams settings', () => {
  test('teams page renders at /settings/teams', async ({ page }) => {
    const teams = new TeamsPage(page)
    await teams.goto()
    await expect(page).toHaveURL(/\/settings\/teams/)
    await expect(teams.heading).toBeVisible()
  })

  test('create team button and dialog are accessible', async ({ page }) => {
    const teams = new TeamsPage(page)
    await teams.goto()
    await expect(teams.createTeamButton).toBeVisible()
    await teams.openCreateDialog()
    await expect(teams.createTeamDialog).toBeVisible()
    await expect(teams.teamNameInput).toBeVisible()
    await expect(teams.teamSlugInput).toBeVisible()
    await expect(teams.submitCreateButton).toBeVisible()
  })

  test('teams list renders or empty state is shown', async ({ page }) => {
    const teams = new TeamsPage(page)
    await teams.goto()
    // Either team cards or the empty state message should be visible
    const hasTeams = await teams.teamCards
      .first()
      .isVisible()
      .catch(() => false)
    if (hasTeams) {
      await expect(teams.teamCards.first()).toBeVisible()
    } else {
      await expect(teams.emptyState).toBeVisible()
    }
  })
})
