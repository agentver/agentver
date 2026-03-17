import { expect, test } from '@playwright/test'
import { McpPage } from './pages/mcp'

test.describe('mcp catalogue', () => {
  test('mcp page renders', async ({ page }) => {
    const mcp = new McpPage(page)
    await mcp.goto()
    await expect(page).toHaveURL(/\/mcp/)
    await expect(mcp.heading).toBeVisible()
  })

  test('page heading displays correct text', async ({ page }) => {
    const mcp = new McpPage(page)
    await mcp.goto()
    await expect(mcp.heading.first()).toHaveText('MCP Servers')
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
    const hasGrid = await mcp.serverGrid.first().isVisible()
    const hasEmptyState = await mcp.emptyState.isVisible()
    expect(hasGrid || hasEmptyState).toBe(true)
  })
})
