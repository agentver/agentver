'use client'

import { cn } from '@agentver/ui-utils'

type SparklineProps = {
  data: number[]
  width?: number
  height?: number
  colour?: string
  className?: string
  ariaLabel?: string
}

export function Sparkline({
  data,
  width = 80,
  height = 24,
  colour = 'oklch(0.65 0.15 250)',
  className,
  ariaLabel = 'Sparkline',
}: SparklineProps) {
  if (data.length < 2) {
    return <div className={cn('inline-block', className)} style={{ width, height }} />
  }

  const padding = 2
  const chartWidth = width - padding * 2
  const chartHeight = height - padding * 2

  const maxValue = Math.max(...data, 1)
  const minValue = Math.min(...data, 0)
  const range = maxValue - minValue || 1

  const getX = (index: number) => padding + (index / (data.length - 1)) * chartWidth
  const getY = (value: number) => padding + chartHeight - ((value - minValue) / range) * chartHeight

  const points = data.map((v, i) => `${getX(i)},${getY(v)}`).join(' L ')
  const linePath = `M ${points}`

  const trend = data[data.length - 1]! - data[0]!
  const trendColour =
    trend > 0 ? 'oklch(0.55 0.15 150)' : trend < 0 ? 'oklch(0.55 0.15 25)' : colour

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className={cn('inline-block', className)}
      style={{ width, height }}
      role="img"
      aria-label={ariaLabel}
    >
      <path
        d={linePath}
        fill="none"
        stroke={trendColour}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle
        cx={getX(data.length - 1)}
        cy={getY(data[data.length - 1]!)}
        r={2}
        fill={trendColour}
      />
    </svg>
  )
}
