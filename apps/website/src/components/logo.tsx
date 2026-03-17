type LogoProps = {
  className?: string
}

export function LogoIcon({ className = '' }: LogoProps) {
  return <img src="/logo.png" alt="" aria-hidden="true" className={className} />
}

export function LogoWordmark({ className = '' }: LogoProps) {
  return (
    <a href="/" className={`flex items-center gap-2.5 ${className}`} aria-label="Agentver home">
      <LogoIcon className="h-8 w-auto" />
      <span className="font-display font-semibold text-foreground text-lg tracking-tight">
        agent<span className="text-primary">ver</span>
      </span>
    </a>
  )
}

export function LogoWordmarkLight({ className = '' }: LogoProps) {
  return (
    <a href="/" className={`flex items-center gap-2.5 ${className}`} aria-label="Agentver home">
      <LogoIcon className="h-8 w-auto" />
      <span className="font-display font-semibold text-lg text-white tracking-tight">
        agent<span className="text-primary">ver</span>
      </span>
    </a>
  )
}
