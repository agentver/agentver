type LogoProps = {
  className?: string
}

export function LogoIcon({ className = '' }: LogoProps) {
  return (
    <svg
      viewBox="0 0 40 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      {/* Leaf body - vert (green) */}
      <path d="M20 3C5 10 1 28 20 45 39 28 35 10 20 3Z" fill="currentColor" />
      {/* Agent nodes - the network */}
      <circle cx="20" cy="16" r="3.5" fill="white" />
      <circle cx="13.5" cy="29" r="2.5" fill="white" />
      <circle cx="26.5" cy="29" r="2.5" fill="white" />
      {/* Branch lines - git graph meets leaf veins */}
      <line
        x1="20"
        y1="19.5"
        x2="13.5"
        y2="26.5"
        stroke="white"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <line
        x1="20"
        y1="19.5"
        x2="26.5"
        y2="26.5"
        stroke="white"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  )
}

export function LogoWordmark({ className = '' }: LogoProps) {
  return (
    <a href="/" className={`flex items-center gap-2.5 ${className}`} aria-label="Agentver home">
      <LogoIcon className="h-8 w-auto text-primary" />
      <span className="font-display font-semibold text-foreground text-lg tracking-tight">
        agentver
      </span>
    </a>
  )
}

export function LogoWordmarkLight({ className = '' }: LogoProps) {
  return (
    <a href="/" className={`flex items-center gap-2.5 ${className}`} aria-label="Agentver home">
      <LogoIcon className="h-8 w-auto text-primary-bright" />
      <span className="font-display font-semibold text-lg text-white tracking-tight">agentver</span>
    </a>
  )
}
