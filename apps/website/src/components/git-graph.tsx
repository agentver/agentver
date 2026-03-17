'use client'

import { useEffect, useState } from 'react'

export function GitGraph({ className = '' }: { className?: string }) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => setVisible(true), 400)
    return () => clearTimeout(timer)
  }, [])

  return (
    <div className={`relative ${className}`} style={{ perspective: '900px' }}>
      <div
        style={{
          transform: 'rotateY(-6deg) rotateX(3deg)',
          transformStyle: 'preserve-3d',
        }}
      >
        <svg
          viewBox="0 0 380 400"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="w-full"
          aria-hidden="true"
        >
          {/* Card background */}
          <rect
            x="10"
            y="10"
            width="360"
            height="380"
            rx="16"
            fill="white"
            stroke="oklch(0.92 0.004 90)"
            strokeWidth="1"
            filter="url(#cardShadow)"
          />
          {/* Title bar */}
          <rect x="10" y="10" width="360" height="44" rx="16" fill="oklch(0.975 0.002 90)" />
          <rect x="10" y="38" width="360" height="16" fill="oklch(0.975 0.002 90)" />

          {/* Window dots */}
          <circle cx="34" cy="32" r="5" fill="oklch(0.72 0.14 25)" />
          <circle cx="50" cy="32" r="5" fill="oklch(0.78 0.11 85)" />
          <circle cx="66" cy="32" r="5" fill="oklch(0.44 0.12 165)" />
          <text
            x="86"
            y="36"
            fill="oklch(0.55 0.01 265)"
            fontSize="11"
            fontFamily="var(--font-mono)"
          >
            skill history
          </text>

          {/* Shadow filter */}
          <defs>
            <filter id="cardShadow" x="-10" y="-5" width="400" height="420">
              <feDropShadow
                dx="0"
                dy="8"
                stdDeviation="16"
                floodColor="oklch(0.12 0.02 265)"
                floodOpacity="0.08"
              />
            </filter>
          </defs>

          {/* Main trunk */}
          <line
            x1="190"
            y1="80"
            x2="190"
            y2="360"
            stroke="oklch(0.44 0.12 165)"
            strokeWidth="2.5"
            strokeLinecap="round"
            opacity="0.2"
            style={{
              strokeDasharray: 280,
              strokeDashoffset: visible ? 0 : 280,
              transition: 'stroke-dashoffset 1.4s cubic-bezier(0.22, 1, 0.36, 1) 0.2s',
            }}
          />

          {/* Left branch */}
          <path
            d="M190 155 C170 155, 110 165, 90 190 L90 250"
            stroke="oklch(0.52 0.12 165)"
            strokeWidth="1.5"
            strokeLinecap="round"
            opacity="0.3"
            style={{
              strokeDasharray: 160,
              strokeDashoffset: visible ? 0 : 160,
              transition: 'stroke-dashoffset 1s cubic-bezier(0.22, 1, 0.36, 1) 0.6s',
            }}
          />

          {/* Right branch */}
          <path
            d="M190 220 C210 220, 270 230, 290 250 L290 290"
            stroke="oklch(0.50 0.10 200)"
            strokeWidth="1.5"
            strokeLinecap="round"
            opacity="0.3"
            style={{
              strokeDasharray: 160,
              strokeDashoffset: visible ? 0 : 160,
              transition: 'stroke-dashoffset 1s cubic-bezier(0.22, 1, 0.36, 1) 0.8s',
            }}
          />

          {/* Merge line */}
          <path
            d="M290 290 C270 310, 210 315, 190 320"
            stroke="oklch(0.50 0.10 200)"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeDasharray="4 4"
            style={{ opacity: visible ? 0.25 : 0, transition: 'opacity 0.6s ease 1.5s' }}
          />

          {/* Main nodes */}
          {(
            [
              { cy: 100, delay: 0.4, label: 'v1.0.0' },
              { cy: 155, delay: 0.6, label: 'v1.1.0' },
              { cy: 220, delay: 0.8, label: 'v1.2.0' },
              { cy: 280, delay: 1.0, label: 'v1.3.0' },
              { cy: 330, delay: 1.3, label: 'v2.0.0' },
            ] as const
          ).map((n) => (
            <g key={n.cy}>
              {/* Glow ring */}
              <circle
                cx={190}
                cy={n.cy}
                r={10}
                fill="oklch(0.44 0.12 165)"
                opacity="0.06"
                style={{
                  transform: visible ? 'scale(1)' : 'scale(0)',
                  transformOrigin: `190px ${n.cy}px`,
                  transition: `transform 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) ${n.delay}s`,
                }}
              />
              {/* Node */}
              <circle
                cx={190}
                cy={n.cy}
                r={6}
                fill="oklch(0.44 0.12 165)"
                style={{
                  transform: visible ? 'scale(1)' : 'scale(0)',
                  transformOrigin: `190px ${n.cy}px`,
                  transition: `transform 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) ${n.delay}s`,
                }}
              />
              {/* Inner dot */}
              <circle
                cx={190}
                cy={n.cy}
                r={2.5}
                fill="white"
                style={{
                  opacity: visible ? 1 : 0,
                  transition: `opacity 0.3s ease ${n.delay + 0.15}s`,
                }}
              />
              {/* Label */}
              <text
                x={206}
                y={n.cy + 4}
                fill="oklch(0.55 0.01 265)"
                fontSize="11"
                fontFamily="var(--font-mono)"
                style={{
                  opacity: visible ? 0.6 : 0,
                  transition: `opacity 0.4s ease ${n.delay + 0.2}s`,
                }}
              >
                {n.label}
              </text>
            </g>
          ))}

          {/* Left branch nodes */}
          {(
            [
              { cy: 200, delay: 0.9 },
              { cy: 232, delay: 1.1 },
            ] as const
          ).map((n) => (
            <g key={`l-${n.cy}`}>
              <circle
                cx={90}
                cy={n.cy}
                r={8}
                fill="oklch(0.52 0.12 165)"
                opacity="0.06"
                style={{
                  transform: visible ? 'scale(1)' : 'scale(0)',
                  transformOrigin: `90px ${n.cy}px`,
                  transition: `transform 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) ${n.delay}s`,
                }}
              />
              <circle
                cx={90}
                cy={n.cy}
                r={4.5}
                fill="oklch(0.52 0.12 165)"
                style={{
                  transform: visible ? 'scale(1)' : 'scale(0)',
                  transformOrigin: `90px ${n.cy}px`,
                  transition: `transform 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) ${n.delay}s`,
                }}
              />
              <circle
                cx={90}
                cy={n.cy}
                r={2}
                fill="white"
                style={{
                  opacity: visible ? 1 : 0,
                  transition: `opacity 0.3s ease ${n.delay + 0.15}s`,
                }}
              />
            </g>
          ))}

          {/* Left label */}
          <text
            x={34}
            y={185}
            fill="oklch(0.52 0.12 165)"
            fontSize="9"
            fontFamily="var(--font-mono)"
            style={{ opacity: visible ? 0.5 : 0, transition: 'opacity 0.5s ease 1s' }}
          >
            fork/deploy
          </text>

          {/* Right branch nodes */}
          {(
            [
              { cy: 258, delay: 1.0 },
              { cy: 282, delay: 1.2 },
            ] as const
          ).map((n) => (
            <g key={`r-${n.cy}`}>
              <circle
                cx={290}
                cy={n.cy}
                r={8}
                fill="oklch(0.50 0.10 200)"
                opacity="0.06"
                style={{
                  transform: visible ? 'scale(1)' : 'scale(0)',
                  transformOrigin: `290px ${n.cy}px`,
                  transition: `transform 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) ${n.delay}s`,
                }}
              />
              <circle
                cx={290}
                cy={n.cy}
                r={4.5}
                fill="oklch(0.50 0.10 200)"
                style={{
                  transform: visible ? 'scale(1)' : 'scale(0)',
                  transformOrigin: `290px ${n.cy}px`,
                  transition: `transform 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) ${n.delay}s`,
                }}
              />
              <circle
                cx={290}
                cy={n.cy}
                r={2}
                fill="white"
                style={{
                  opacity: visible ? 1 : 0,
                  transition: `opacity 0.3s ease ${n.delay + 0.15}s`,
                }}
              />
            </g>
          ))}

          {/* Right label */}
          <text
            x={304}
            y={252}
            fill="oklch(0.50 0.10 200)"
            fontSize="9"
            fontFamily="var(--font-mono)"
            style={{ opacity: visible ? 0.5 : 0, transition: 'opacity 0.5s ease 1.2s' }}
          >
            draft
          </text>

          {/* Version tags */}
          {(
            [
              { y: 100, delay: 0.6 },
              { y: 330, delay: 1.5 },
            ] as const
          ).map((tag) => (
            <g
              key={`tag-${tag.y}`}
              style={{ opacity: visible ? 1 : 0, transition: `opacity 0.5s ease ${tag.delay}s` }}
            >
              <rect
                x={256}
                y={tag.y - 10}
                width={52}
                height={20}
                rx={10}
                fill="oklch(0.44 0.12 165)"
                fillOpacity="0.08"
                stroke="oklch(0.44 0.12 165)"
                strokeWidth="0.8"
                strokeOpacity="0.2"
              />
              <text
                x={282}
                y={tag.y + 3}
                fill="oklch(0.44 0.12 165)"
                fontSize="9"
                fontFamily="var(--font-mono)"
                textAnchor="middle"
              >
                release
              </text>
            </g>
          ))}
        </svg>
      </div>

      {/* Ground shadow for 3D depth */}
      <div
        className="absolute -bottom-3 left-1/2 h-6 w-[80%] -translate-x-1/2 rounded-full bg-foreground/[0.03] blur-lg"
        aria-hidden="true"
      />
    </div>
  )
}
