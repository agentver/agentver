import { useConnectivity } from '../hooks/useConnectivity'

type StatusConfig = {
  colourClass: string
  label: string
  pulse: boolean
}

const STATUS_MAP: Record<string, StatusConfig> = {
  connected: { colourClass: 'bg-green-500 text-green-500', label: 'Connected', pulse: false },
  offline: { colourClass: 'bg-yellow-500 text-yellow-500', label: 'Offline', pulse: false },
  reconnecting: {
    colourClass: 'bg-primary text-primary',
    label: 'Back online — syncing...',
    pulse: true,
  },
}

export function OfflineIndicator() {
  const { status } = useConnectivity()
  const config = STATUS_MAP[status]

  const dotColourClass = config.colourClass.split(' ')[0]
  const textColourClass = config.colourClass.split(' ')[1]

  return (
    <div className="flex items-center gap-1.5 px-2 py-1">
      <div
        className={`size-1.5 shrink-0 rounded-full ${dotColourClass} ${config.pulse ? 'animate-[pulse_1.5s_ease-in-out_infinite]' : ''}`}
        style={{ boxShadow: '0 0 6px currentColor' }}
      />
      <span
        className={`whitespace-nowrap font-medium text-[0.7rem] tracking-[0.01em] ${textColourClass}`}
      >
        {config.label}
      </span>
    </div>
  )
}
