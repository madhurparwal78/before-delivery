import { createPortal } from 'react-dom'
import { useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react'
import type { Currency } from '../shared/i18n'
import { useApp } from './state'

export const prefersReducedMotion = (): boolean => window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** A money amount: visible text inside an element carrying data-minor and data-currency. */
export function Money({ minor, currency, className }: { minor: number; currency?: Currency; className?: string }) {
  const app = useApp()
  const code = currency ?? app.cur
  return <span className={className} data-minor={minor} data-currency={code}>{app.money(minor, code)}</span>
}

export function Tag({ kind, children }: { kind: 'sage' | 'orange' | 'acid' | 'black' | 'plain'; children: ReactNode }) {
  return <span className={`tag tag-${kind}`}>{children}</span>
}

/** A button that is disabled and aria-busy while its action is in flight. */
export function Button({ busy, className = '', children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { busy?: boolean }) {
  return <button type="button" {...rest} className={`btn ${className}`} aria-busy={busy ? 'true' : undefined} disabled={rest.disabled || busy}>{children}</button>
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((element) => element.tabIndex >= 0 && !element.hasAttribute('inert') && element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden')
}

function dialogHost(): HTMLElement {
  let host = document.getElementById('dialogs')
  if (!host) {
    host = document.createElement('div')
    host.id = 'dialogs'
    document.body.append(host)
  }
  return host
}

interface DialogProps {
  label: string
  open?: boolean
  onClose?: () => void
  /** alertdialog: Escape does not close it. */
  alert?: boolean
  /** Bottom sheet that rises with the named `sheet-open` animation. */
  sheet?: string
  /** Where focus goes on close when the opener is gone. */
  returnTo?: () => HTMLElement | null
  className?: string
  children: ReactNode
  dataIndex?: number
}

/** Modal dialog: Tab wraps inside, Escape closes (not for alerts), focus returns to the opener. */
export function Dialog({ label, open = true, onClose, alert, sheet, returnTo, className = '', children, dataIndex }: DialogProps) {
  const ref = useRef<HTMLDivElement>(null)
  const closing = useRef(onClose)
  closing.current = onClose
  const returning = useRef(returnTo)
  returning.current = returnTo
  const id = useId()

  useEffect(() => {
    if (!open || !ref.current) return
    const opener = document.activeElement as HTMLElement | null
    const root = document.getElementById('root')
    root?.setAttribute('inert', '')
    const element = ref.current
    const first = element.querySelector<HTMLElement>('[data-autofocus]') ?? focusables(element)[0] ?? element
    first.focus()
    if (sheet && !prefersReducedMotion()) {
      const animation = element.animate([{ transform: 'translateY(100%)' }, { transform: 'translateY(0)' }], { duration: 240, easing: 'cubic-bezier(.2,.8,.2,1)' })
      animation.id = 'sheet-open'
    }
    const onKey = (event: globalThis.KeyboardEvent): void => {
      if (event.key === 'Escape' && !alert) {
        event.preventDefault()
        event.stopPropagation()
        closing.current?.()
        return
      }
      if (event.key !== 'Tab') return
      const items = focusables(element)
      if (!items.length) return event.preventDefault()
      const active = document.activeElement as HTMLElement
      const at = items.indexOf(active)
      if (event.shiftKey && (at <= 0 || !element.contains(active))) {
        event.preventDefault()
        items[items.length - 1].focus()
      } else if (!event.shiftKey && (at === items.length - 1 || !element.contains(active))) {
        event.preventDefault()
        items[0].focus()
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      root?.removeAttribute('inert')
      const target = opener && document.contains(opener) && !opener.closest('[inert]') ? opener : returning.current?.()
      target?.focus()
    }
  }, [open, alert, sheet])

  if (!open) return null
  return createPortal(
    <div className={`scrim ${sheet ? 'scrim-sheet' : ''}`}>
      <div ref={ref} role={alert ? 'alertdialog' : 'dialog'} aria-modal="true" aria-label={label} tabIndex={-1} data-sheet={sheet} data-index={dataIndex} className={`dialog ${sheet ? 'sheet' : ''} ${className}`} id={id}>
        {children}
      </div>
    </div>,
    dialogHost(),
  )
}

/** A whole-number input with the spinbutton role: arrows, Home and End, and typed digits. */
export function Spinbutton({ label, value, min, max, onChange, className = '', ...rest }: {
  label: string; value: number; min: number; max: number; onChange: (value: number) => void; className?: string; 'data-focus-key'?: string; disabled?: boolean
}) {
  const [text, setText] = useState(String(value))
  useEffect(() => setText(String(value)), [value])
  const commit = (next: number): void => {
    const clamped = Math.min(max, Math.max(min, next))
    setText(String(clamped))
    if (clamped !== value) onChange(clamped)
  }
  const onKey = (event: KeyboardEvent<HTMLInputElement>): void => {
    const steps: Record<string, number> = { ArrowUp: value + 1, ArrowDown: value - 1, Home: min, End: max }
    if (event.key in steps) {
      event.preventDefault()
      commit(steps[event.key])
    }
  }
  return (
    <input
      {...rest}
      className={`field spin ${className}`} role="spinbutton" type="text" inputMode="numeric" autoComplete="off" aria-label={label}
      aria-valuenow={value} aria-valuemin={min} aria-valuemax={max} value={text}
      onKeyDown={onKey}
      onChange={(event) => {
        setText(event.target.value)
        if (/^\d+$/.test(event.target.value)) {
          const next = Number(event.target.value)
          if (next >= min && next <= max && next !== value) onChange(next)
        }
      }}
      onBlur={() => setText(String(value))}
    />
  )
}

export const BigWord = ({ word, sentence }: { word: string; sentence: string }) => (
  <section className="empty">
    <p className="giant" aria-hidden="false" style={{ '--chars': word.length } as CSSProperties}>{word}</p>
    <p>{sentence}</p>
  </section>
)
