type Hunk = { file: string; additions: number; deletions: number; content: string }
type DiffViewerProps = { hunks: Hunk[] }

function getLineClasses(line: string): string {
  if (line.startsWith('+')) return 'bg-green-500/10 text-green-500'
  if (line.startsWith('-')) return 'bg-destructive/10 text-destructive'
  if (line.startsWith('@')) return 'bg-primary/10 text-primary'
  return 'text-muted-foreground'
}

export function DiffViewer({ hunks }: DiffViewerProps) {
  if (hunks.length === 0)
    return (
      <div className="p-8 text-center">
        <span className="text-muted-foreground text-sm">No changes to display</span>
      </div>
    )

  return (
    <div className="flex flex-col gap-4">
      {hunks.map((hunk) => {
        const lines = hunk.content.split('\n')
        return (
          <div
            key={`${hunk.file}-${hunk.additions}-${hunk.deletions}`}
            className="overflow-hidden rounded-lg border border-border"
          >
            <div className="flex items-center justify-between bg-accent px-4 py-2.5">
              <span className="font-medium font-mono text-foreground text-xs">{hunk.file}</span>
              <span className="flex items-center gap-2 font-mono text-xs">
                {hunk.additions > 0 && (
                  <span className="font-medium text-green-500">+{hunk.additions}</span>
                )}
                {hunk.deletions > 0 && (
                  <span className="font-medium text-destructive">-{hunk.deletions}</span>
                )}
              </span>
            </div>
            <div className="overflow-x-auto bg-card">
              <pre className="m-0 py-3 font-mono text-xs leading-relaxed">
                {lines.map((line, index) => (
                  <div
                    key={`${hunk.file}-line-${index}`}
                    className={`min-h-[1.4em] whitespace-pre px-4 ${getLineClasses(line)}`}
                  >
                    {line}
                  </div>
                ))}
              </pre>
            </div>
          </div>
        )
      })}
    </div>
  )
}
