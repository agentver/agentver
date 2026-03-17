import { useEffect } from 'react'
import type { Theme } from './useSettings'

/**
 * Applies the given theme to the document root element.
 *
 * - 'system': follows the OS preference via matchMedia and listens for changes
 * - 'light': removes the 'dark' class from <html>
 * - 'dark': adds the 'dark' class to <html>
 */
export function useTheme(theme: Theme): void {
  useEffect(() => {
    const root = document.documentElement

    if (theme === 'light') {
      root.classList.remove('dark')
      return
    }

    if (theme === 'dark') {
      root.classList.add('dark')
      return
    }

    // theme === 'system'
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')

    function applySystemTheme(e: MediaQueryList | MediaQueryListEvent) {
      if (e.matches) {
        root.classList.add('dark')
      } else {
        root.classList.remove('dark')
      }
    }

    applySystemTheme(mediaQuery)
    mediaQuery.addEventListener('change', applySystemTheme)

    return () => {
      mediaQuery.removeEventListener('change', applySystemTheme)
    }
  }, [theme])
}
