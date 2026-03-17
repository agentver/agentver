'use client'

import { useEffect, useRef, useState } from 'react'

export function StatCounter({
  value,
  suffix = '',
  label,
  delay = 0,
}: {
  value: number
  suffix?: string
  label: string
  delay?: number
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [count, setCount] = useState(0)
  const [started, setStarted] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setStarted(true)
          observer.disconnect()
        }
      },
      { threshold: 0.5 }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!started) return
    const timer = setTimeout(() => {
      const duration = 1200
      const steps = 30
      let step = 0
      const interval = setInterval(() => {
        step++
        const progress = step / steps
        const eased = 1 - (1 - progress) ** 3
        setCount(Math.round(eased * value))
        if (step >= steps) {
          clearInterval(interval)
          setCount(value)
        }
      }, duration / steps)
      return () => clearInterval(interval)
    }, delay)
    return () => clearTimeout(timer)
  }, [started, value, delay])

  return (
    <div ref={ref} className="text-center">
      <div className="font-bold font-display text-4xl text-primary tracking-tight md:text-5xl">
        {count}
        {suffix}
      </div>
      <div className="mt-2 text-dark-muted text-sm">{label}</div>
    </div>
  )
}
