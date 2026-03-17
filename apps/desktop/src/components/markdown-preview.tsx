import { useMemo } from 'react'

type MarkdownPreviewProps = { content: string }

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function renderMarkdown(md: string): string {
  const stripped = md.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '')
  let html = stripped
    .replace(
      /```(\w*)\n([\s\S]*?)```/g,
      (_m, lang: string, code: string) =>
        `<pre><code class="lang-${lang}">${escapeHtml(code.trim())}</code></pre>`
    )
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/^######\s+(.+)$/gm, '<h6>$1</h6>')
    .replace(/^#####\s+(.+)$/gm, '<h5>$1</h5>')
    .replace(/^####\s+(.+)$/gm, '<h4>$1</h4>')
    .replace(/^###\s+(.+)$/gm, '<h3>$1</h3>')
    .replace(/^##\s+(.+)$/gm, '<h2>$1</h2>')
    .replace(/^#\s+(.+)$/gm, '<h1>$1</h1>')
    .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
    .replace(/^[-*]\s+(.+)$/gm, '<li>$1</li>')
    .replace(/^\d+\.\s+(.+)$/gm, '<li>$1</li>')
    .replace(/^---$/gm, '<hr />')
    .replace(/^>\s+(.+)$/gm, '<blockquote>$1</blockquote>')
    .replace(/\n\n/g, '</p><p>')
  html = html.replace(/(<li>[\s\S]*?<\/li>)/g, '<ul>$1</ul>').replace(/<\/ul>\s*<ul>/g, '')
  html = `<p>${html}</p>`
    .replace(/<p>\s*<\/p>/g, '')
    .replace(/<p>(<(?:h[1-6]|pre|ul|ol|blockquote|hr)[^>]*>)/g, '$1')
    .replace(/(<\/(?:h[1-6]|pre|ul|ol|blockquote)>)<\/p>/g, '$1')
  return html
}

export function MarkdownPreview({ content }: MarkdownPreviewProps) {
  const html = useMemo(() => renderMarkdown(content), [content])

  return (
    <div className="flex h-full flex-col overflow-hidden border-border border-l bg-muted">
      <div className="shrink-0 border-border border-b px-3 py-2.5">
        <span className="font-semibold text-[0.7rem] text-muted-foreground uppercase tracking-wider">
          Preview
        </span>
      </div>
      <div className="flex-1 overflow-y-auto p-5">
        <div
          className="markdown-preview max-w-full break-words text-foreground text-sm leading-relaxed"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </div>
    </div>
  )
}
