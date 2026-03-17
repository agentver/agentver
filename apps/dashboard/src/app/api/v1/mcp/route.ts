import { prisma } from '@agentver/database'
import { NextResponse } from 'next/server'

// ---------------------------------------------------------------------------
// GET /api/v1/mcp — Search/browse MCP server catalogue
// ---------------------------------------------------------------------------

export async function GET(request: Request) {
  const url = new URL(request.url)
  const query = url.searchParams.get('q')
  const category = url.searchParams.get('category')
  const transport = url.searchParams.get('transport')
  const verified = url.searchParams.get('verified')
  const limit = Math.min(Number(url.searchParams.get('limit') ?? '50'), 100)
  const cursor = url.searchParams.get('cursor')

  const where: Record<string, unknown> = {}

  if (query) {
    where.OR = [
      { name: { contains: query, mode: 'insensitive' } },
      { displayName: { contains: query, mode: 'insensitive' } },
      { description: { contains: query, mode: 'insensitive' } },
    ]
  }

  if (category) {
    where.categories = { has: category }
  }

  if (transport) {
    where.transport = transport
  }

  if (verified === 'true') {
    where.verified = true
  }

  const definitions = await prisma.mcpServerDefinition.findMany({
    where,
    take: limit + 1,
    cursor: cursor ? { id: cursor } : undefined,
    orderBy: [{ verified: 'desc' }, { installCount: 'desc' }, { name: 'asc' }],
  })

  const hasMore = definitions.length > limit
  const items = hasMore ? definitions.slice(0, -1) : definitions

  return NextResponse.json({
    items,
    nextCursor: hasMore ? items[items.length - 1]?.id : undefined,
  })
}
