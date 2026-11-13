import { useEffect, useLayoutEffect, useRef, type ReactNode, type RefObject } from 'react'
import { navigate } from './router'

/** A polite live region that stays in the page and only changes when its next message replaces it. */
export function Status({ name, text, className = '' }: { name: string; text: string; className?: string }) {
  return (
    <div role="status" aria-label={name} className={`status ${className}`} data-empty={text === ''}>
      {text}
    </div>
  )
}

export function Link({ to, children, current, ariaLabel }: { to: string; children: ReactNode; current?: boolean; ariaLabel?: string }) {
  return (
    <a
      href={to}
      className={current ? 'current' : undefined}
      aria-current={current ? 'page' : undefined}
      aria-label={ariaLabel}
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return
        event.preventDefault()
        navigate(to)
      }}
    >
      {children}
    </a>
  )
}

export function FieldError({ id, message }: { id: string; message: string | undefined }) {
  return message ? (
    <p id={id} className="field-error">
      <span className="marker" aria-hidden="true" />
      {message}
    </p>
  ) : null
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

interface DialogProps {
  name: string
  onClose: () => void
  children: ReactNode
  /** The control focus returns to when the dialog closes; defaults to whatever had focus when it opened. */
  returnFocus?: () => HTMLElement | null
  /** Where focus lands on open; defaults to the first focusable control. */
  initialFocus?: RefObject<HTMLElement | null>
}

/** A modal dialog: Tab stays inside, Escape closes, focus returns to the opener. */
export function Dialog({ name, onClose, children, returnFocus, initialFocus }: DialogProps) {
  const panel = useRef<HTMLDivElement>(null)
  const closing = useRef(onClose)
  closing.current = onClose
  const returning = useRef(returnFocus)
  returning.current = returnFocus

  useLayoutEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const target = initialFocus?.current ?? panel.current?.querySelector<HTMLElement>(FOCUSABLE)
    target?.focus()
    return () => {
      const back = returning.current?.() ?? opener
      if (back && document.contains(back)) back.focus()
    }
  }, [initialFocus])

  useEffect(() => {
    const node = panel.current
    if (!node) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        closing.current()
        return
      }
      if (event.key !== 'Tab') return
      const items = [...node.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null || el === document.activeElement)
      const first = items[0]
      const last = items[items.length - 1]
      if (!first || !last) return
      const active = document.activeElement
      if (event.shiftKey && (active === first || !node.contains(active))) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && (active === last || !node.contains(active))) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="scrim">
      <div ref={panel} role="dialog" aria-modal="true" aria-label={name} className="dialog">
        {children}
      </div>
    </div>
  )
}

export function RadioGroup<T extends string>({
  name, value, options, onChange, groupName, className = '',
}: {
  name: string
  value: T
  options: readonly { value: T; label: string }[]
  onChange: (value: T) => void
  groupName: string
  className?: string
}) {
  return (
    <div role="radiogroup" aria-label={name} className={`radios ${className}`}>
      {options.map((option) => (
        <label key={option.value} className="radio">
          <input type="radio" name={groupName} checked={value === option.value} onChange={() => onChange(option.value)} />
          <span>{option.label}</span>
        </label>
      ))}
    </div>
  )
}
