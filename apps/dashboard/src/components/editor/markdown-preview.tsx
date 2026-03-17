'use client'

import Markdown from 'react-markdown'
import remarkFrontmatter from 'remark-frontmatter'
import remarkGfm from 'remark-gfm'

type MarkdownPreviewProps = {
  content: string
  className?: string
}

export function MarkdownPreview({ content, className }: MarkdownPreviewProps) {
  return (
    <div className={`prose prose-sm dark:prose-invert max-w-none ${className ?? ''}`}>
      <Markdown remarkPlugins={[remarkGfm, remarkFrontmatter]}>{content}</Markdown>
    </div>
  )
}
