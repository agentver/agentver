import { prisma } from '@agentver/database'
import { parseFrontmatter } from '@agentver/shared'
import { NextResponse } from 'next/server'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ org: string; name: string }> }
) {
  const { org, name } = await params

  const pkg = await prisma.package.findFirst({
    where: {
      name,
      organisation: { slug: org },
      visibility: 'PUBLIC',
    },
    select: {
      type: true,
      readme: true,
    },
  })

  if (!pkg) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const rawContent = pkg.readme

  if (!rawContent) {
    return NextResponse.json({ error: 'No content available' }, { status: 404 })
  }

  // For SKILL type, strip frontmatter and return the markdown body
  if (pkg.type === 'SKILL') {
    const { body } = parseFrontmatter(rawContent)
    return NextResponse.json({
      type: pkg.type,
      content: body,
    })
  }

  // For other types, return the full content
  return NextResponse.json({
    type: pkg.type,
    content: rawContent,
  })
}
