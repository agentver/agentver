import { validateSkillMd } from '@agentver/shared'
import { cn } from '@agentver/ui-utils'
import { useMemo } from 'react'

type FrontmatterValidatorProps = { content: string; visible: boolean }

export function FrontmatterValidator({ content, visible }: FrontmatterValidatorProps) {
  const validation = useMemo(() => {
    if (!content.trim()) return null
    return validateSkillMd(content)
  }, [content])
  if (!visible || !validation) return null

  const hasErrors = validation.errors.length > 0
  const hasWarnings = validation.warnings.length > 0
  const isValid = validation.valid

  return (
    <div
      className={cn(
        'shrink-0 border-y px-3 py-2',
        hasErrors
          ? 'border-destructive/30 bg-destructive/5'
          : hasWarnings
            ? 'border-yellow-500/30 bg-yellow-500/5'
            : 'border-green-500/30 bg-green-500/5'
      )}
    >
      <div className="flex items-center gap-1.5">
        {isValid ? (
          <>
            <svg
              width="14"
              height="14"
              viewBox="0 0 14 14"
              fill="none"
              stroke="#22c55e"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="7" cy="7" r="6" />
              <path d="M4.5 7l2 2 3.5-3.5" />
            </svg>
            <span className="flex items-center gap-2 font-medium text-green-500 text-xs">
              Frontmatter valid
              {validation.specCompliant && (
                <span className="rounded border border-green-800 bg-green-950 px-1.5 py-px font-medium text-[0.65rem] text-green-500">
                  agentskills.io compliant
                </span>
              )}
            </span>
          </>
        ) : (
          <>
            <svg
              width="14"
              height="14"
              viewBox="0 0 14 14"
              fill="none"
              stroke="#ef4444"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="7" cy="7" r="6" />
              <path d="M5 5l4 4M9 5l-4 4" />
            </svg>
            <span className="font-medium text-destructive text-xs">Frontmatter invalid</span>
          </>
        )}
        {validation.agentverExtensions.length > 0 && (
          <span className="ml-auto rounded border border-primary/30 bg-primary/10 px-1.5 py-px font-medium text-[0.65rem] text-primary">
            +{validation.agentverExtensions.length} agentver extension
            {validation.agentverExtensions.length > 1 ? 's' : ''}
          </span>
        )}
      </div>
      {hasErrors && (
        <div className="mt-1.5 flex flex-col gap-1">
          {validation.errors.map((err, i) => (
            <div key={`err-${i}`} className="flex items-start gap-1.5">
              <svg
                width="14"
                height="14"
                viewBox="0 0 14 14"
                fill="none"
                stroke="#ef4444"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="shrink-0"
              >
                <circle cx="7" cy="7" r="6" />
                <path d="M5 5l4 4M9 5l-4 4" />
              </svg>
              <span className="text-destructive text-xs leading-snug">{err}</span>
            </div>
          ))}
        </div>
      )}
      {hasWarnings && (
        <div className="mt-1.5 flex flex-col gap-1">
          {validation.warnings.map((warn, i) => (
            <div key={`warn-${i}`} className="flex items-start gap-1.5">
              <svg
                width="14"
                height="14"
                viewBox="0 0 14 14"
                fill="none"
                stroke="#f59e0b"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="shrink-0"
              >
                <path d="M7 1.5l6 11H1l6-11z" />
                <path d="M7 6v2.5M7 10.5v0" />
              </svg>
              <span className="text-xs text-yellow-500 leading-snug">{warn}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
