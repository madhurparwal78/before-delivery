import { useEffect, useRef, useState } from 'react'
import { finishWalkthrough } from '../actions'
import { useAppState } from '../state'
import { trapFocus } from '../ui/overlay'
import { Button } from '../ui/primitives'

const STEPS: Array<[string, string]> = [
  ['Pick an open end', 'Select the end of a module where track should continue.'],
  ['Add track', 'Press a tile to add a piece to that end.'],
  ['Check the standard', 'Check layout shows every rule your layout breaks.'],
  ['Switch to Operate', 'Use the switch to open a session and watch the blocks.'],
  ['Give the road', 'Select a train, choose a destination and press Highball.'],
]

// Line art in the accent blue, 3px strokes: the picture matches the input device, with one region filled per step.
function Art({ touch, step }: { touch: boolean; step: number }) {
  const fill = (index: number): string => (step === index ? 'var(--accent)' : 'none')
  return touch ? (
    <svg role="img" aria-label="Touch gestures illustration" data-testid="walkthrough-art" data-input="touch" viewBox="0 0 180 110" width="180" height="110" fill="none" stroke="var(--accent)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <rect x="22" y="12" width="52" height="86" rx="10" />
      <rect x="32" y="26" width="32" height="40" rx="4" fill={fill(0)} fillOpacity="0.35" />
      <path d="M40 80h16" fill={fill(1)} />
      <path d="M118 96V54a7 7 0 0 1 14 0v14l22 4a9 9 0 0 1 7 10l-3 12" />
      <path d="M90 40h18M99 31v18" />
      <circle cx="132" cy="44" r="12" fill={fill(4)} fillOpacity="0.35" />
    </svg>
  ) : (
    <svg role="img" aria-label="Mouse and keyboard illustration" data-testid="walkthrough-art" data-input="pointer" viewBox="0 0 180 110" width="180" height="110" fill="none" stroke="var(--accent)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <rect x="18" y="52" width="92" height="46" rx="8" />
      <path d="M30 66h12M50 66h12M70 66h12M90 66h12M30 82h72" />
      <rect x="126" y="24" width="34" height="56" rx="17" />
      <path d="M143 24v26M126 50h34" />
      <rect x="127" y="25" width="16" height="25" rx="8" fill={fill(0)} fillOpacity="0.35" />
      <path d="M126 20 112 6" />
    </svg>
  )
}

export function Walkthrough() {
  const { walkthroughOpen, boot } = useAppState()
  const [step, setStep] = useState(0)
  const [leaving, setLeaving] = useState(false)
  const wasOpen = useRef(false)
  const card = useRef<HTMLDivElement>(null)
  const touch = useRef(window.matchMedia('(pointer: coarse)').matches)
  const visible = walkthroughOpen && boot === 'ready'

  useEffect(() => {
    if (visible) {
      wasOpen.current = true
      card.current?.focus()
      return undefined
    }
    if (!wasOpen.current) return undefined
    wasOpen.current = false
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return undefined
    setLeaving(true)
    const timer = window.setTimeout(() => setLeaving(false), 500)
    return () => window.clearTimeout(timer)
  }, [visible])

  if (!visible && !leaving) return null
  const last = step === STEPS.length - 1
  const [title, line] = STEPS[step]
  return (
    <div className={`walkthrough-layer${leaving ? ' leaving' : ''}`}>
      <div
        ref={card}
        role="dialog"
        aria-modal="true"
        aria-label="First layout walkthrough"
        data-testid="walkthrough-card"
        className="walkthrough"
        tabIndex={-1}
        onKeyDown={event => trapFocus(event, card.current)}
      >
        <button type="button" className="skip" onClick={() => void finishWalkthrough()}>Skip</button>
        <div className="walkthrough-body" key={step}>
          <Art touch={touch.current} step={step} />
          <h2 className="sheet-title" data-testid="walkthrough-title">{title}</h2>
          <p>{line}</p>
        </div>
        <Button onClick={() => (last ? void finishWalkthrough() : setStep(step + 1))}>{last ? 'Start building' : 'Next'}</Button>
        <div role="group" aria-label={`Step ${step + 1} of ${STEPS.length}`} className="dots">
          {STEPS.map((_, index) => <span key={index} className={`dot${index === step ? ' active' : ''}`} />)}
        </div>
      </div>
    </div>
  )
}
