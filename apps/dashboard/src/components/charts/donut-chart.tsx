'use client'

import { cn } from '@agentver/ui-utils'
import { useEffect, useState } from 'react'

type DonutSegment = {
  label: string
  value: number
  colour: string
}

type DonutChartProps = {
  data: DonutSegment[]
  size?: number
  strokeWidth?: number
  className?: string
  ariaLabel?: string
  centreLabel?: string
  centreValue?: string
}

const COLOURS = [
  'oklch(0.65 0.15 250)',
  'oklch(0.65 0.15 150)',
  'oklch(0.65 0.15 50)',
  'oklch(0.65 0.15 330)',
  'oklch(0.65 0.15 200)',
  'oklch(0.55 0.10 100)',
  'oklch(0.60 0.12 280)',
  'oklch(0.70 0.10 30)',
]

export function DonutChart({
  data,
  size = 200,
  strokeWidth = 32,
  className,
  ariaLabel = 'Donut chart',
  centreLabel,
  centreValue,
}: DonutChartProps) {
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    const frame = requestAnimationFrame(() => setMounted(true))
    return () => cancelAnimationFrame(frame)
  }, [])

  if (data.length === 0) {
    return (
      <div
        className={cn('flex items-center justify-center text-muted-foreground text-sm', className)}
        style={{ height: size }}
      >
        No data available
      </div>
    )
  }

  const total = data.reduce((sum, d) => sum + d.value, 0)
  if (total === 0) {
    return (
      <div
        className={cn('flex items-center justify-center text-muted-foreground text-sm', className)}
        style={{ height: size }}
      >
        No data available
      </div>
    )
  }

  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const cx = size / 2
  const cy = size / 2

  let cumulativeOffset = 0

  const segments = data.map((d, i) => {
    const percentage = d.value / total
    const segmentLength = percentage * circumference
    const gapSize = data.length > 1 ? 4 : 0
    const adjustedLength = Math.max(segmentLength - gapSize, 0)
    const offset = cumulativeOffset
    cumulativeOffset += segmentLength

    return {
      ...d,
      colour: d.colour || COLOURS[i % COLOURS.length],
      dashArray: `${adjustedLength} ${circumference - adjustedLength}`,
      dashOffset: -offset,
      percentage,
    }
  })

  return (
    <div className={cn('flex items-center gap-6', className)}>
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg
          viewBox={`0 0 ${size} ${size}`}
          className="w-full"
          style={{ height: size }}
          role="img"
          aria-label={ariaLabel}
        >
          <circle
            cx={cx}
            cy={cy}
            r={radius}
            fill="none"
            className="stroke-muted/30"
            strokeWidth={strokeWidth}
          />

          {segments.map((seg) => (
            <circle
              key={seg.label}
              cx={cx}
              cy={cy}
              r={radius}
              fill="none"
              stroke={seg.colour}
              strokeWidth={strokeWidth}
              strokeDasharray={seg.dashArray}
              strokeDashoffset={seg.dashOffset}
              strokeLinecap="round"
              className="transition-all duration-700"
              style={{
                opacity: mounted ? 1 : 0,
                transform: 'rotate(-90deg)',
                transformOrigin: `${cx}px ${cy}px`,
              }}
            />
          ))}

          {centreValue && (
            <>
              <text
                x={cx}
                y={cy - 4}
                textAnchor="middle"
                className="fill-foreground font-display font-semibold text-[24px]"
              >
                {centreValue}
              </text>
              {centreLabel && (
                <text
                  x={cx}
                  y={cy + 16}
                  textAnchor="middle"
                  className="fill-muted-foreground text-[11px]"
                >
                  {centreLabel}
                </text>
              )}
            </>
          )}
        </svg>
      </div>

      <div className="flex flex-col gap-2">
        {segments.map((seg) => (
          <div key={seg.label} className="flex items-center gap-2 text-sm">
            <div className="size-3 shrink-0 rounded-full" style={{ backgroundColor: seg.colour }} />
            <span className="text-foreground">{seg.label}</span>
            <span className="text-muted-foreground">({Math.round(seg.percentage * 100)}%)</span>
          </div>
        ))}
      </div>
    </div>
  )
}
