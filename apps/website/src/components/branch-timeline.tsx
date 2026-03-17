'use client'

import type { ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'

const COLOURS = {
  green: { line: '#1a8a5c', glow: '#1a8a5c30' },
  teal: { line: '#2a9daa', glow: '#2a9daa30' },
  blue: { line: '#5b7fd6', glow: '#5b7fd630' },
  amber: { line: '#c89024', glow: '#c8902430' },
} as const

type Colour = keyof typeof COLOURS

function useReveal(threshold = 0.2) {
  const ref = useRef<HTMLDivElement>(null)
  const [show, setShow] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setTimeout(() => setShow(true), 150)
          observer.disconnect()
        }
      },
      { threshold }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [threshold])
  return { ref, show }
}

/* ═══ Timeline wrapper with vertical lanes ═══ */
export function BranchTimeline({
  children,
  className = '',
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div className={`relative ${className}`}>
      {/* Vertical lane lines - z-10 so they show above section backgrounds */}
      <Lane colour="green" x={72} from={5} to={96} />
      <Lane colour="teal" x={100} from={14} to={84} />
      <Lane colour="blue" x={128} from={30} to={70} />
      <Lane colour="amber" x={156} from={48} to={58} />
      {children}
    </div>
  )
}

function Lane({ colour, x, from, to }: { colour: Colour; x: number; from: number; to: number }) {
  return (
    <div
      className="pointer-events-none absolute z-10 hidden w-[3px] rounded-full md:block"
      style={{ left: x, top: `${from}%`, height: `${to - from}%` }}
      aria-hidden="true"
    >
      <div
        className="h-full w-full rounded-full"
        style={{
          background: `linear-gradient(to bottom, transparent, ${COLOURS[colour].line}45 10%, ${COLOURS[colour].line}30 50%, ${COLOURS[colour].line}45 90%, transparent)`,
        }}
      />
    </div>
  )
}

/* ═══ Commit node - sits exactly on a lane ═══ */
export function BranchNode({
  label,
  colour = 'green',
  size = 'md',
  className = '',
}: {
  label?: string
  colour?: Colour
  size?: 'sm' | 'md' | 'lg'
  className?: string
}) {
  const { ref, show } = useReveal(0.5)
  const c = COLOURS[colour]
  const laneX: Record<Colour, number> = { green: 72, teal: 100, blue: 128, amber: 156 }
  const x = laneX[colour]
  const s = { sm: { n: 12, r: 22, d: 4 }, md: { n: 16, r: 30, d: 6 }, lg: { n: 22, r: 42, d: 9 } }[
    size
  ]

  return (
    <div
      ref={ref}
      className={`relative z-10 flex h-14 items-center ${className}`}
      aria-hidden="true"
    >
      <div
        className="absolute hidden md:block"
        style={{ left: x, transform: 'translate(-50%, 0)' }}
      >
        {/* Glow */}
        <div
          className="absolute rounded-full"
          style={{
            width: s.r,
            height: s.r,
            left: -(s.r - s.n) / 2,
            top: -(s.r - s.n) / 2,
            backgroundColor: c.glow,
            transform: show ? 'scale(1)' : 'scale(0)',
            transition: 'transform 0.7s cubic-bezier(0.34, 1.56, 0.64, 1)',
          }}
        />
        {size === 'lg' && (
          <div
            className="absolute rounded-full"
            style={{
              width: s.r + 18,
              height: s.r + 18,
              left: -(s.r + 18 - s.n) / 2,
              top: -(s.r + 18 - s.n) / 2,
              backgroundColor: `${c.line}10`,
              transform: show ? 'scale(1)' : 'scale(0)',
              transition: 'transform 0.9s cubic-bezier(0.34, 1.56, 0.64, 1)',
            }}
          />
        )}
        {/* Circle */}
        <div
          className="rounded-full"
          style={{
            width: s.n,
            height: s.n,
            backgroundColor: c.line,
            boxShadow: `0 0 16px ${c.glow}`,
            transform: show ? 'scale(1)' : 'scale(0)',
            transition: 'transform 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) 0.1s',
          }}
        />
        {/* Inner dot */}
        <div
          className="absolute rounded-full bg-white"
          style={{
            width: s.d,
            height: s.d,
            left: (s.n - s.d) / 2,
            top: (s.n - s.d) / 2,
            opacity: show ? 1 : 0,
            transition: 'opacity 0.3s ease 0.3s',
          }}
        />
      </div>

      {/* Label */}
      {label && (
        <div
          className="absolute hidden md:block"
          style={{
            left: x + s.r / 2 + 14,
            opacity: show ? 1 : 0,
            transform: show ? 'translateX(0)' : 'translateX(-8px)',
            transition: 'all 0.5s ease 0.35s',
          }}
        >
          <span
            className="whitespace-nowrap rounded-full border px-3 py-1 font-mono text-[11px]"
            style={{
              borderColor: `${c.line}20`,
              backgroundColor: `${c.line}08`,
              color: `${c.line}90`,
            }}
          >
            {label}
          </span>
        </div>
      )}
    </div>
  )
}

/* ═══ Curve connecting between lanes (fork or merge) ═══ */
export function BranchMultiCurve({
  pairs,
  direction = 'fork',
  className = '',
}: {
  pairs: [Colour, Colour][]
  direction?: 'fork' | 'merge'
  className?: string
}) {
  const { ref, show } = useReveal(0.15)
  const laneX: Record<Colour, number> = { green: 72, teal: 100, blue: 128, amber: 156 }

  return (
    <div ref={ref} className={`relative z-10 hidden h-32 md:block ${className}`} aria-hidden="true">
      <svg className="absolute top-0 left-0 h-full w-[250px]" viewBox="0 0 250 128" fill="none">
        {pairs.map(([from, to], i) => {
          const x1 = laneX[from]
          const x2 = laneX[to]
          const c = COLOURS[to]
          const d =
            direction === 'fork'
              ? `M${x1} 0 C${x1} 56, ${x2} 72, ${x2} 128`
              : `M${x2} 0 C${x2} 56, ${x1} 72, ${x1} 128`
          return (
            <path
              key={`${from}-${to}`}
              d={d}
              stroke={c.line}
              strokeWidth="3"
              strokeLinecap="round"
              style={{
                opacity: show ? 0.35 : 0,
                strokeDasharray: 200,
                strokeDashoffset: show ? 0 : 200,
                transition: `stroke-dashoffset 1s cubic-bezier(0.22, 1, 0.36, 1) ${0.1 + i * 0.12}s, opacity 0.4s ease ${0.05 + i * 0.08}s`,
              }}
            />
          )
        })}
      </svg>
    </div>
  )
}

/* ═══ Ambient: vertical curved branch lines flowing down behind content ═══ */
export function BranchWisps() {
  const { ref, show } = useReveal(0.03)

  /* Each wisp is a tall, gently curved vertical path flowing downward.
     They originate from the lane area (x ~70-160) and curve outward
     behind the content area as they flow down. */
  const paths = [
    // Green branches sweeping right and down
    {
      d: 'M72 0 C72 200, 250 400, 300 800 C330 1000, 280 1200, 350 1600',
      c: 'green' as Colour,
      w: 2.5,
      o: 0.06,
      delay: 0,
    },
    {
      d: 'M72 200 C72 500, 400 700, 500 1100 C550 1300, 480 1500, 550 1900',
      c: 'green' as Colour,
      w: 2,
      o: 0.04,
      delay: 0.3,
    },
    {
      d: 'M72 600 C72 800, 350 1000, 420 1400 C460 1600, 400 1800, 480 2200',
      c: 'green' as Colour,
      w: 2,
      o: 0.05,
      delay: 0.6,
    },
    {
      d: 'M72 1200 C72 1400, 300 1600, 380 2000 C420 2200, 360 2400, 440 2800',
      c: 'green' as Colour,
      w: 2.5,
      o: 0.05,
      delay: 0.9,
    },
    {
      d: 'M72 1800 C72 2000, 280 2200, 350 2600 C380 2800, 320 3000, 400 3400',
      c: 'green' as Colour,
      w: 2,
      o: 0.04,
      delay: 1.2,
    },
    {
      d: 'M72 2400 C72 2600, 320 2800, 400 3200 C440 3400, 380 3600, 460 4000',
      c: 'green' as Colour,
      w: 2,
      o: 0.05,
      delay: 1.5,
    },

    // Teal branches
    {
      d: 'M100 100 C100 400, 350 600, 450 1000 C500 1200, 430 1400, 520 1800',
      c: 'teal' as Colour,
      w: 2,
      o: 0.04,
      delay: 0.2,
    },
    {
      d: 'M100 800 C100 1000, 400 1200, 480 1600 C520 1800, 460 2000, 540 2400',
      c: 'teal' as Colour,
      w: 2,
      o: 0.035,
      delay: 0.7,
    },
    {
      d: 'M100 1500 C100 1700, 380 1900, 460 2300 C500 2500, 440 2700, 520 3100',
      c: 'teal' as Colour,
      w: 2,
      o: 0.04,
      delay: 1.1,
    },
    {
      d: 'M100 2200 C100 2400, 350 2600, 440 3000 C480 3200, 420 3400, 500 3800',
      c: 'teal' as Colour,
      w: 2,
      o: 0.035,
      delay: 1.4,
    },

    // Blue branches (shorter, further right)
    {
      d: 'M128 400 C128 600, 500 800, 600 1200 C650 1400, 580 1600, 660 2000',
      c: 'blue' as Colour,
      w: 1.5,
      o: 0.03,
      delay: 0.5,
    },
    {
      d: 'M128 1200 C128 1400, 480 1600, 580 2000 C630 2200, 560 2400, 640 2800',
      c: 'blue' as Colour,
      w: 1.5,
      o: 0.025,
      delay: 1.0,
    },
    {
      d: 'M128 2000 C128 2200, 520 2400, 620 2800 C670 3000, 600 3200, 680 3600',
      c: 'blue' as Colour,
      w: 1.5,
      o: 0.03,
      delay: 1.3,
    },

    // Amber (brief)
    {
      d: 'M156 1400 C156 1600, 550 1800, 650 2200 C700 2400, 630 2600, 710 3000',
      c: 'amber' as Colour,
      w: 1.5,
      o: 0.02,
      delay: 1.1,
    },
  ]

  return (
    <div
      ref={ref}
      className="pointer-events-none absolute inset-0 z-[1] overflow-hidden"
      aria-hidden="true"
    >
      <svg
        className="absolute top-0 left-0 h-full w-full"
        preserveAspectRatio="xMinYMin slice"
        viewBox="0 0 1400 4000"
      >
        {paths.map((p, i) => (
          <path
            key={i}
            d={p.d}
            stroke={COLOURS[p.c].line}
            strokeWidth={p.w}
            strokeLinecap="round"
            fill="none"
            style={{
              opacity: show ? p.o : 0,
              strokeDasharray: 3000,
              strokeDashoffset: show ? 0 : 3000,
              transition: `stroke-dashoffset 3s cubic-bezier(0.22, 1, 0.36, 1) ${p.delay}s, opacity 0.8s ease ${p.delay}s`,
            }}
          />
        ))}
      </svg>
    </div>
  )
}

/* ═══ Segment: bold trunk emphasis ═══ */
export function BranchSegment({ className = '' }: { className?: string }) {
  const { ref, show } = useReveal(0.2)
  return (
    <div ref={ref} className={`relative z-10 hidden h-8 md:block ${className}`} aria-hidden="true">
      <div
        className="absolute h-full w-[3px]"
        style={{ left: 72, transform: 'translateX(-1.5px)' }}
      >
        <div
          className="h-full w-full rounded-full"
          style={{
            backgroundColor: COLOURS.green.line,
            opacity: show ? 0.5 : 0,
            transform: show ? 'scaleY(1)' : 'scaleY(0)',
            transformOrigin: 'top',
            transition: 'transform 0.5s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.3s ease',
          }}
        />
      </div>
    </div>
  )
}
