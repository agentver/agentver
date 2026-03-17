'use client'

import { useState } from 'react'

type TerminalLine = {
  text: string
  type?: 'command' | 'output' | 'success' | 'comment'
}

export function Terminal({
  title,
  lines,
  className = '',
  showCursor = true,
}: {
  title?: string
  lines: TerminalLine[]
  className?: string
  showCursor?: boolean
}) {
  const [copied, setCopied] = useState(false)

  const commands = lines
    .filter((l) => l.type === 'command')
    .map((l) => l.text)
    .join('\n')

  const handleCopy = async () => {
    if (!commands) return
    await navigator.clipboard.writeText(commands)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div
      className={`group overflow-hidden rounded-xl border border-border bg-surface shadow-sm transition-all hover:shadow-md ${className}`}
    >
      <div className="flex items-center justify-between border-border border-b px-4 py-2.5">
        <div className="flex items-center gap-3">
          <div className="flex gap-1.5">
            <span className="size-2.5 rounded-full bg-[oklch(0.70_0.15_25)]" />
            <span className="size-2.5 rounded-full bg-[oklch(0.75_0.12_85)]" />
            <span className="size-2.5 rounded-full bg-primary" />
          </div>
          {title && <span className="font-mono text-muted text-xs tracking-wide">{title}</span>}
        </div>
        {commands && (
          <button
            type="button"
            onClick={handleCopy}
            className="font-mono text-muted text-xs opacity-0 transition-all duration-200 hover:text-primary group-hover:opacity-100"
          >
            {copied ? '✓ copied' : 'copy'}
          </button>
        )}
      </div>
      <div className="overflow-x-auto p-4 font-mono text-[13px] leading-[1.75]">
        {lines.map((line, i) => (
          <div key={i} className={lineStyle(line.type)}>
            {line.type === 'command' && <span className="select-none text-primary">$ </span>}
            {line.text || '\u00A0'}
          </div>
        ))}
        {showCursor && (
          <div className="mt-0.5">
            <span className="select-none text-primary">$ </span>
            <span className="inline-block h-[14px] w-[7px] translate-y-[2px] animate-blink bg-primary" />
          </div>
        )}
      </div>
    </div>
  )
}

function lineStyle(type?: TerminalLine['type']): string {
  switch (type) {
    case 'command':
      return 'text-foreground'
    case 'success':
      return 'text-primary'
    case 'comment':
      return 'text-muted'
    default:
      return 'text-muted'
  }
}
