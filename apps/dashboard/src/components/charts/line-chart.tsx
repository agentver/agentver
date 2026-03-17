'use client'

import { cn } from '@agentver/ui-utils'
import { useEffect, useRef, useState } from 'react'

type DataPoint = {
  label: string
  value: number
}

type LineChartProps = {
  data: DataPoint[]
  height?: number
  colour?: string
  showArea?: boolean
  showGrid?: boolean
  showLabels?: boolean
  className?: string
  ariaLabel?: string
}

const PADDING = { top: 20, right: 16, bottom: 32, left: 48 }

function formatAxisValue(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`
  return String(value)
}

export function LineChart({
  data,
  height = 280,
  colour = 'oklch(0.65 0.15 250)',
  showArea = true,
  showGrid = true,
  showLabels = true,
  className,
  ariaLabel = 'Line chart',
}: LineChartProps) {
  const [mounted, setMounted] = useState(false)
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)

  useEffect(() => {
    const frame = requestAnimationFrame(() => setMounted(true))
    return () => cancelAnimationFrame(frame)
  }, [])

  if (data.length === 0) {
    return (
      <div
        className={cn('flex items-center justify-center text-muted-foreground text-sm', className)}
        style={{ height }}
      >
        No data available
      </div>
    )
  }

  const viewWidth = 600
  const chartWidth = viewWidth - PADDING.left - PADDING.right
  const chartHeight = height - PADDING.top - PADDING.bottom

  const maxValue = Math.max(...data.map((d) => d.value), 1)
  const minValue = 0

  const yRange = maxValue - minValue || 1
  const yStep = yRange / 4

  const getX = (index: number) => PADDING.left + (index / Math.max(data.length - 1, 1)) * chartWidth

  const getY = (value: number) =>
    PADDING.top + chartHeight - ((value - minValue) / yRange) * chartHeight

  const pathPoints = data.map((d, i) => `${getX(i)},${getY(d.value)}`).join(' L ')
  const linePath = `M ${pathPoints}`

  const areaPath = `M ${getX(0)},${getY(0)} L ${pathPoints} L ${getX(data.length - 1)},${getY(0)} Z`

  const gridLines = Array.from({ length: 5 }, (_, i) => minValue + yStep * i)

  const labelInterval = Math.max(1, Math.ceil(data.length / 7))

  return (
    <div className={cn('relative', className)}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${viewWidth} ${height}`}
        className="w-full"
        style={{ height }}
        role="img"
        aria-label={ariaLabel}
      >
        {showGrid &&
          gridLines.map((val) => (
            <g key={val}>
              <line
                x1={PADDING.left}
                y1={getY(val)}
                x2={viewWidth - PADDING.right}
                y2={getY(val)}
                className="stroke-border"
                strokeDasharray="4 4"
                strokeWidth={1}
              />
              {showLabels && (
                <text
                  x={PADDING.left - 8}
                  y={getY(val) + 4}
                  textAnchor="end"
                  className="fill-muted-foreground text-[11px]"
                >
                  {formatAxisValue(val)}
                </text>
              )}
            </g>
          ))}

        {showArea && (
          <path
            d={areaPath}
            fill={colour}
            className="transition-opacity duration-700"
            style={{ opacity: mounted ? 0.1 : 0 }}
          />
        )}

        <path
          d={linePath}
          fill="none"
          stroke={colour}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="transition-all duration-700"
          style={{
            strokeDasharray: mounted ? 'none' : `${chartWidth * 3}`,
            strokeDashoffset: mounted ? 0 : chartWidth * 3,
          }}
        />

        {data.map((d, i) => (
          <g key={d.label}>
            <circle
              cx={getX(i)}
              cy={getY(d.value)}
              r={hoveredIndex === i ? 5 : 3}
              fill={colour}
              className="transition-all duration-150"
              style={{ opacity: mounted ? 1 : 0 }}
            />

            <rect
              x={getX(i) - chartWidth / data.length / 2}
              y={PADDING.top}
              width={chartWidth / data.length}
              height={chartHeight}
              fill="transparent"
              onMouseEnter={() => setHoveredIndex(i)}
              onMouseLeave={() => setHoveredIndex(null)}
              className="cursor-crosshair"
            />

            {showLabels && i % labelInterval === 0 && (
              <text
                x={getX(i)}
                y={height - 8}
                textAnchor="middle"
                className="fill-muted-foreground text-[10px]"
              >
                {d.label}
              </text>
            )}
          </g>
        ))}

        {hoveredIndex !== null && data[hoveredIndex] && (
          <g>
            <line
              x1={getX(hoveredIndex)}
              y1={PADDING.top}
              x2={getX(hoveredIndex)}
              y2={PADDING.top + chartHeight}
              className="stroke-muted-foreground/30"
              strokeWidth={1}
              strokeDasharray="4 4"
            />
            <rect
              x={getX(hoveredIndex) - 40}
              y={getY(data[hoveredIndex].value) - 28}
              width={80}
              height={22}
              rx={6}
              className="fill-popover stroke-border"
              strokeWidth={1}
            />
            <text
              x={getX(hoveredIndex)}
              y={getY(data[hoveredIndex].value) - 14}
              textAnchor="middle"
              className="fill-foreground font-medium text-[11px]"
            >
              {data[hoveredIndex].label}: {data[hoveredIndex].value}
            </text>
          </g>
        )}
      </svg>
    </div>
  )
}
