import { expect, test } from '@playwright/test'
import { McpPage } from './pages/mcp'

test.describe('mcp catalogue', () => {
  test('mcp page renders with correct heading', async ({ page }) => {
    const mcp = new McpPage(page)
    await mcp.goto()
    await expect(page).toHaveURL(/\/mcp/)
    await expect(mcp.heading).toBeVisible()
    await expect(mcp.heading).toContainText('MCP Servers')
  })

  test('search bar is visible and accepts input', async ({ page }) => {
    const mcp = new McpPage(page)
    await mcp.goto()
    await expect(mcp.searchInput).toBeVisible()
    await mcp.searchInput.fill('github')
    await expect(mcp.searchInput).toHaveValue('github')
  })

  test('server cards or empty state with info is visible', async ({ page }) => {
    const mcp = new McpPage(page)
    await mcp.goto()
    await expect(mcp.serverGrid.or(mcp.emptyState)).toBeVisible()
  })
})
