'use client'

import { cn } from '@agentver/ui-utils'
import { useEffect, useState } from 'react'

type BarDataPoint = {
  label: string
  value: number
  colour?: string
}

type BarChartProps = {
  data: BarDataPoint[]
  height?: number
  defaultColour?: string
  className?: string
  ariaLabel?: string
}

const BAR_HEIGHT = 28
const BAR_GAP = 8
const LABEL_WIDTH = 120
const VALUE_WIDTH = 60

export function BarChart({
  data,
  defaultColour = 'oklch(0.65 0.15 250)',
  className,
  ariaLabel = 'Bar chart',
}: BarChartProps) {
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    const frame = requestAnimationFrame(() => setMounted(true))
    return () => cancelAnimationFrame(frame)
  }, [])

  if (data.length === 0) {
    return (
      <div
        className={cn('flex items-center justify-center text-muted-foreground text-sm', className)}
        style={{ height: 120 }}
      >
        No data available
      </div>
    )
  }

  const maxValue = Math.max(...data.map((d) => d.value), 1)
  const totalHeight = data.length * (BAR_HEIGHT + BAR_GAP) - BAR_GAP + 16
  const viewWidth = 600
  const barAreaWidth = viewWidth - LABEL_WIDTH - VALUE_WIDTH - 16

  return (
    <div className={cn('relative', className)}>
      <svg
        viewBox={`0 0 ${viewWidth} ${totalHeight}`}
        className="w-full"
        style={{ height: totalHeight }}
        role="img"
        aria-label={ariaLabel}
      >
        {data.map((d, i) => {
          const y = i * (BAR_HEIGHT + BAR_GAP) + 8
          const barWidth = (d.value / maxValue) * barAreaWidth
          const fillColour = d.colour ?? defaultColour

          return (
            <g key={d.label}>
              <text
                x={LABEL_WIDTH - 8}
                y={y + BAR_HEIGHT / 2 + 4}
                textAnchor="end"
                className="fill-foreground text-[12px]"
              >
                {d.label.length > 16 ? `${d.label.slice(0, 14)}...` : d.label}
              </text>

              <rect
                x={LABEL_WIDTH}
                y={y}
                width={barAreaWidth}
                height={BAR_HEIGHT}
                rx={6}
                className="fill-muted/40"
              />

              <rect
                x={LABEL_WIDTH}
                y={y}
                width={mounted ? barWidth : 0}
                height={BAR_HEIGHT}
                rx={6}
                fill={fillColour}
                style={{
                  opacity: 0.8,
                  transition: `width 600ms cubic-bezier(0.4, 0, 0.2, 1) ${i * 60}ms`,
                }}
              />

              <text
                x={LABEL_WIDTH + barAreaWidth + 8}
                y={y + BAR_HEIGHT / 2 + 4}
                textAnchor="start"
                className="fill-muted-foreground font-medium text-[12px]"
              >
                {d.value.toLocaleString('en-GB')}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}
