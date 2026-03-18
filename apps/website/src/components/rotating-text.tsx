'use client'

import { useEffect, useRef, useState } from 'react'

const SCRAMBLE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz01!@#$%<>/|{}'
const SCRAMBLE_DURATION = 1100
const EXIT_DURATION = 350

const TOP_WORDS = [
  'Version control',
  'Team platform',
  'Security scanner',
  'Credential vault',
  'Review workflows',
]
const BOTTOM_WORDS = ['AI agents', 'skills', 'plugins', 'MCPs', 'credentials']

type FadeWordProps = {
  text: string
  visible: boolean
  color: string
}

function FadeWord({ text, visible, color }: FadeWordProps) {
  return (
    <span
      style={{
        color,
        display: 'inline-block',
        opacity: visible ? 1 : 0,
        filter: visible ? 'blur(0px)' : 'blur(6px)',
        transform: visible ? 'translateY(0)' : 'translateY(-6px)',
        transition: 'opacity 0.35s ease, filter 0.35s ease, transform 0.35s ease',
      }}
    >
      {text}
    </span>
  )
}

type ScrambleWordProps = {
  target: string
  color: string
}

function ScrambleWord({ target, color }: ScrambleWordProps) {
  const [displayed, setDisplayed] = useState(target)
  const [exiting, setExiting] = useState(false)
  const prevTarget = useRef(target)
  const rafRef = useRef<number | null>(null)

  useEffect(() => {
    if (target === prevTarget.current) return
    prevTarget.current = target

    setExiting(true)

    const exitTimeout = setTimeout(() => {
      setExiting(false)

      const start = performance.now()

      function frame(now: number) {
        const elapsed = now - start
        const progress = Math.min(elapsed / SCRAMBLE_DURATION, 1)
        const lockedCount = Math.floor(progress * target.length)

        const chars = Array.from({ length: target.length }, (_, i) => {
          if (i < lockedCount) return target[i]
          if (target[i] === ' ') return ' '
          return SCRAMBLE_CHARS[Math.floor(Math.random() * SCRAMBLE_CHARS.length)]
        })

        setDisplayed(chars.join(''))

        if (progress < 1) {
          rafRef.current = requestAnimationFrame(frame)
        }
      }

      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      rafRef.current = requestAnimationFrame(frame)
    }, EXIT_DURATION)

    return () => {
      clearTimeout(exitTimeout)
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [target])

  return (
    <span
      style={{
        color,
        display: 'inline-block',
        opacity: exiting ? 0 : 1,
        filter: exiting ? 'blur(8px)' : 'blur(0px)',
        transform: exiting ? 'translateY(-5px) scale(0.96)' : 'translateY(0) scale(1)',
        transition: `opacity ${EXIT_DURATION}ms ease, filter ${EXIT_DURATION}ms ease, transform ${EXIT_DURATION}ms ease`,
      }}
    >
      {displayed}
    </span>
  )
}

function useWordCycle(words: string[], intervalMs: number) {
  const [index, setIndex] = useState(0)

  useEffect(() => {
    const interval = setInterval(() => {
      setIndex((i) => (i + 1) % words.length)
    }, intervalMs)
    return () => clearInterval(interval)
  }, [words.length, intervalMs])

  return words[index]!
}

function useFadeWord(words: string[], intervalMs: number) {
  const [index, setIndex] = useState(0)
  const [visible, setVisible] = useState(true)

  useEffect(() => {
    const interval = setInterval(() => {
      setVisible(false)
      setTimeout(() => {
        setIndex((i) => (i + 1) % words.length)
        setVisible(true)
      }, 350)
    }, intervalMs)
    return () => clearInterval(interval)
  }, [words.length, intervalMs])

  return { word: words[index]!, visible }
}

export function HeroHeadline() {
  const { word: topWord, visible: topVisible } = useFadeWord(TOP_WORDS, 4500)
  const bottomWord = useWordCycle(BOTTOM_WORDS, 3200)

  return (
    <>
      <h1 className="sr-only">
        Manage, version, and deploy AI agent skills across Claude Code, Cursor, Copilot, and 40+
        coding assistants
      </h1>
      <div
        aria-hidden="true"
        className="font-bold font-display text-5xl leading-[1.06] tracking-tight md:text-7xl"
      >
        <FadeWord text={topWord} visible={topVisible} color="oklch(0.12 0.02 265)" />
        <br />
        <span className="text-4xl md:text-7xl" style={{ color: 'oklch(0.38 0.13 170)' }}>
          for <ScrambleWord target={bottomWord} color="oklch(0.38 0.13 170)" />
        </span>
      </div>
    </>
  )
}
