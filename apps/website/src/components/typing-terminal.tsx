'use client'

import { useEffect, useRef, useState } from 'react'

type TerminalStep = {
  command: string
  outputs: { text: string; type: 'output' | 'success' | 'error' }[]
}

export function TypingTerminal({
  steps,
  title,
  className = '',
}: {
  steps: TerminalStep[]
  title?: string
  className?: string
}) {
  const [currentStep, setCurrentStep] = useState(0)
  const [charIndex, setCharIndex] = useState(0)
  const [showOutputs, setShowOutputs] = useState(false)
  const [completedSteps, setCompletedSteps] = useState<number[]>([])
  const containerRef = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setVisible(true)
          observer.disconnect()
        }
      },
      { threshold: 0.3 }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!visible || currentStep >= steps.length) return

    const step = steps[currentStep]
    if (!step) return

    if (charIndex < step.command.length) {
      const speed = step.command[charIndex] === ' ' ? 40 : 20 + Math.random() * 40
      const timer = setTimeout(() => setCharIndex((c) => c + 1), speed)
      return () => clearTimeout(timer)
    }

    if (!showOutputs) {
      const timer = setTimeout(() => setShowOutputs(true), 300)
      return () => clearTimeout(timer)
    }

    const timer = setTimeout(() => {
      setCompletedSteps((prev) => [...prev, currentStep])
      setCurrentStep((s) => s + 1)
      setCharIndex(0)
      setShowOutputs(false)
    }, 1200)
    return () => clearTimeout(timer)
  }, [visible, currentStep, charIndex, showOutputs, steps])

  return (
    <div
      ref={containerRef}
      className={`overflow-hidden rounded-2xl border border-dark-border bg-dark-bg shadow-2xl shadow-black/30 ${className}`}
    >
      <div className="flex items-center justify-between border-dark-border border-b px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="flex gap-1.5">
            <span className="size-2.5 rounded-full bg-[oklch(0.65_0.15_25)]" />
            <span className="size-2.5 rounded-full bg-[oklch(0.70_0.12_85)]" />
            <span className="size-2.5 rounded-full bg-primary" />
          </div>
          {title && (
            <span className="font-mono text-dark-muted text-xs tracking-wide">{title}</span>
          )}
        </div>
      </div>

      <div className="min-h-[220px] p-5 font-mono text-[13px] leading-[1.8]">
        {/* Completed steps */}
        {completedSteps.map((stepIdx) => {
          const step = steps[stepIdx]
          if (!step) return null
          return (
            <div key={stepIdx} className="mb-2">
              <div className="text-dark-text">
                <span className="select-none text-primary">$ </span>
                {step.command}
              </div>
              {step.outputs.map((out, oi) => (
                <div key={oi} className={outputStyle(out.type)}>
                  {out.text}
                </div>
              ))}
            </div>
          )
        })}

        {/* Current step */}
        {currentStep < steps.length && (
          <div>
            <div className="text-dark-text">
              <span className="select-none text-primary">$ </span>
              {steps[currentStep]?.command.slice(0, charIndex)}
              {charIndex < (steps[currentStep]?.command.length ?? 0) && (
                <span className="inline-block h-[14px] w-[7px] translate-y-[2px] animate-blink bg-primary" />
              )}
            </div>
            {showOutputs &&
              steps[currentStep]?.outputs.map((out, oi) => (
                <div
                  key={oi}
                  className={outputStyle(out.type)}
                  style={{
                    animation: `fade-up 0.3s ease ${oi * 80}ms both`,
                  }}
                >
                  {out.text}
                </div>
              ))}
          </div>
        )}

        {/* Final cursor */}
        {currentStep >= steps.length && (
          <div className="mt-1">
            <span className="select-none text-primary">$ </span>
            <span className="inline-block h-[14px] w-[7px] translate-y-[2px] animate-blink bg-primary" />
          </div>
        )}
      </div>
    </div>
  )
}

function outputStyle(type: 'output' | 'success' | 'error'): string {
  switch (type) {
    case 'success':
      return 'text-primary'
    case 'error':
      return 'text-[oklch(0.65_0.15_25)]'
    default:
      return 'text-dark-muted'
  }
}
