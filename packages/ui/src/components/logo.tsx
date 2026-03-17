type LogoProps = {
  className?: string
}

export function LogoIcon({ className = '' }: LogoProps) {
  return <img src="/logo.png" alt="" aria-hidden="true" className={className} />
}
