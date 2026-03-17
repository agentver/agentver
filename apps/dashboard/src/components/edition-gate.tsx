import { type Edition, getEdition } from '@agentver/shared'

type EditionGateProps = {
  edition: Edition | Edition[]
  children: React.ReactNode
  fallback?: React.ReactNode
}

export function EditionGate({ edition, children, fallback = null }: EditionGateProps) {
  const currentEdition = getEdition()
  const allowed = Array.isArray(edition)
    ? edition.includes(currentEdition)
    : edition === currentEdition

  if (!allowed) return fallback
  return children
}
