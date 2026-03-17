import { fetch } from '@tauri-apps/plugin-http'
import { useCallback, useEffect, useRef, useState } from 'react'
import { getAuthData } from '../lib/auth'
import { DEFAULT_PLATFORM_URL } from '../lib/config'

type ConnectivityStatus = 'connected' | 'offline' | 'reconnecting'

const CHECK_INTERVAL_MS = 30_000

export function useConnectivity() {
  const [status, setStatus] = useState<ConnectivityStatus>('offline')
  const previousStatus = useRef<ConnectivityStatus>('offline')

  const checkConnectivity = useCallback(async () => {
    const auth = await getAuthData()
    const platformUrl = auth?.platformUrl ?? DEFAULT_PLATFORM_URL

    try {
      const response = await fetch(`${platformUrl}/api/v1/health`, {
        method: 'HEAD',
        connectTimeout: 5000,
      })

      const wasOffline = previousStatus.current === 'offline'

      if (response.ok && wasOffline && previousStatus.current !== 'connected') {
        setStatus('reconnecting')
        previousStatus.current = 'reconnecting'
        // Brief reconnecting state before settling to connected
        setTimeout(() => {
          setStatus('connected')
          previousStatus.current = 'connected'
        }, 3000)
      } else if (response.ok) {
        setStatus('connected')
        previousStatus.current = 'connected'
      } else {
        setStatus('offline')
        previousStatus.current = 'offline'
      }
    } catch {
      setStatus('offline')
      previousStatus.current = 'offline'
    }
  }, [])

  useEffect(() => {
    checkConnectivity()
    const interval = setInterval(checkConnectivity, CHECK_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [checkConnectivity])

  return { status, checkConnectivity }
}
