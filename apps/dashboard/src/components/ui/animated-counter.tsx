'use client'

import { cn } from '@agentver/ui-utils'
import { useEffect, useRef, useState } from 'react'

type AnimatedCounterProps = {
  value: number
  duration?: number
  prefix?: string
  suffix?: string
  className?: string
}

function easeOutCubic(t: number): number {
  return 1 - (1 - t) ** 3
}

export function AnimatedCounter({
  value,
  duration = 1000,
  prefix,
  suffix,
  className,
}: AnimatedCounterProps) {
  const [displayValue, setDisplayValue] = useState(0)
  const containerRef = useRef<HTMLSpanElement>(null)
  const hasAnimated = useRef(false)

  useEffect(() => {
    const el = containerRef.current
    if (!el || hasAnimated.current) return

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting || hasAnimated.current) return

        hasAnimated.current = true
        observer.disconnect()

        const startTime = performance.now()

        function animate(currentTime: number) {
          const elapsed = currentTime - startTime
          const progress = Math.min(elapsed / duration, 1)
          const easedProgress = easeOutCubic(progress)

          setDisplayValue(Math.round(easedProgress * value))

          if (progress < 1) {
            requestAnimationFrame(animate)
          }
        }

        requestAnimationFrame(animate)
      },
      { threshold: 0.1 }
    )

    observer.observe(el)
    return () => observer.disconnect()
  }, [value, duration])

  const formattedValue = displayValue.toLocaleString('en-GB')

  return (
    <span ref={containerRef} className={cn(className)}>
      {prefix}
      {formattedValue}
      {suffix}
    </span>
  )
}
