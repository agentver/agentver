import { useState } from 'react'

type AuthRequiredProps = {
  feature: string
  isAuthenticated: boolean
  onSignIn: () => void
  children: React.ReactNode
}

function LockIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="6" width="8" height="6" rx="1" />
      <path d="M5 6V4a2 2 0 014 0v2" />
    </svg>
  )
}

export function AuthRequired({ feature, isAuthenticated, onSignIn, children }: AuthRequiredProps) {
  const [tooltipVisible, setTooltipVisible] = useState(false)

  if (isAuthenticated) {
    return <>{children}</>
  }

  return (
    <div
      className="relative inline-flex cursor-pointer"
      onMouseEnter={() => setTooltipVisible(true)}
      onMouseLeave={() => setTooltipVisible(false)}
      onClick={onSignIn}
    >
      <div className="relative inline-flex">
        <div className="pointer-events-none opacity-40 grayscale-[0.5]">{children}</div>
        <div className="absolute -top-1 -right-1 flex items-center justify-center rounded border border-border bg-muted p-0.5 text-muted-foreground transition-opacity">
          <LockIcon />
        </div>
      </div>

      {tooltipVisible && (
        <div className="absolute bottom-[calc(100%+8px)] left-1/2 z-50 -translate-x-1/2 animate-[fadeIn_0.15s_ease-out] whitespace-nowrap rounded-md border border-border bg-popover px-2.5 py-1.5 shadow-md">
          <span className="font-medium text-foreground text-xs">Sign in to use {feature}</span>
        </div>
      )}
    </div>
  )
}
