'use client'

import { useEffect, useState } from 'react'

const TOP_WORDS = [
  'Version control',
  'Team platform',
  'Security scanner',
  'Credential vault',
  'Review workflows',
]
const BOTTOM_WORDS = ['AI agents', 'skills', 'plugins', 'MCPs', 'credentials']

type WordProps = {
  text: string
  visible: boolean
  color: string
}

function Word({ text, visible, color }: WordProps) {
  return (
    <span
      style={{
        color,
        opacity: visible ? 1 : 0,
        filter: visible ? 'blur(0px)' : 'blur(6px)',
        transform: visible ? 'translateY(0)' : 'translateY(-6px)',
        transition: 'opacity 0.35s ease, filter 0.35s ease, transform 0.35s ease',
        display: 'inline-block',
      }}
    >
      {text}
    </span>
  )
}

function useRotatingWord(words: string[], intervalMs: number) {
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

  return { word: words[index], visible }
}

export function HeroHeadline() {
  const top = useRotatingWord(TOP_WORDS, 3000)
  const bottom = useRotatingWord(BOTTOM_WORDS, 2100)

  return (
    <h1 className="font-bold font-display text-5xl leading-[1.06] tracking-tight md:text-7xl">
      <Word text={top.word} visible={top.visible} color="oklch(0.56 0.19 148)" />
      <br />
      for <Word text={bottom.word} visible={bottom.visible} color="oklch(0.38 0.13 170)" />
    </h1>
  )
}
