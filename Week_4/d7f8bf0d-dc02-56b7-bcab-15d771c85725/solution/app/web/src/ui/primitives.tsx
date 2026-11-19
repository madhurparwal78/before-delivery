import { useEffect, useId, useRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react'
import { trapFocus, useLayer } from './overlay'

export function Button({ busy = false, className = '', children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { busy?: boolean }) {
  return (
    <button type="button" className={`btn ${className}`} aria-busy={busy || undefined} {...rest}>
      {children}
    </button>
  )
}

interface FieldProps { label: string; error?: string; hint?: string }

export function TextField({ label, error, hint, ...rest }: FieldProps & InputHTMLAttributes<HTMLInputElement>) {
  const id = useId()
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <input className="input" aria-invalid={error ? true : undefined} aria-describedby={error ? `${id}-error` : undefined} {...rest} />
      {hint ? <span className="field-hint">{hint}</span> : null}
      {error ? <span id={`${id}-error`} className="field-error">{error}</span> : null}
    </label>
  )
}

interface Option { value: string; label: string }

export function SelectField({ label, error, options, ...rest }: FieldProps & { options: Option[] } & SelectHTMLAttributes<HTMLSelectElement>) {
  const id = useId()
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <select className="input select" aria-invalid={error ? true : undefined} aria-describedby={error ? `${id}-error` : undefined} {...rest}>
        {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
      {error ? <span id={`${id}-error`} className="field-error">{error}</span> : null}
    </label>
  )
}

interface SurfaceProps {
  title: string
  testId: string
  onClose: () => void
  children: ReactNode
  // Conflict, Deadlock and the Piece inspector are non-modal and keep the focus where the person put it.
  focusOnOpen?: boolean
  className?: string
}

// A sheet slides over the live stage: from the right on desktop and tablet, from the bottom on phones.
export function Sheet({ title, testId, onClose, children, focusOnOpen = true, className = '' }: SurfaceProps) {
  const heading = useId()
  const box = useRef<HTMLElement>(null)
  useLayer(onClose)
  useEffect(() => {
    if (focusOnOpen) box.current?.focus({ preventScroll: true })
  }, [focusOnOpen])
  return (
    <section ref={box} role="dialog" aria-modal="false" aria-labelledby={heading} data-testid={testId} tabIndex={-1} className={`sheet ${className}`}>
      <header className="sheet-head">
        <h2 id={heading} className="sheet-title">{title}</h2>
        <Button className="btn-ghost" onClick={onClose}>Close</Button>
      </header>
      <div className="sheet-body">{children}</div>
    </section>
  )
}

// A focused task over the stage (New workspace, Add module, Rename and the like).
export function Modal({ title, testId, onClose, children }: Omit<SurfaceProps, 'focusOnOpen' | 'className'>) {
  const heading = useId()
  const box = useRef<HTMLDivElement>(null)
  useLayer(onClose)
  useEffect(() => {
    box.current?.querySelector<HTMLElement>('input, select, textarea, button:not(.btn-ghost)')?.focus({ preventScroll: true })
  }, [])
  return (
    <div className="modal-layer">
      <div ref={box} role="dialog" aria-modal="true" aria-labelledby={heading} data-testid={testId} className="modal" onKeyDown={event => trapFocus(event, box.current)}>
        <h2 id={heading} className="sheet-title">{title}</h2>
        {children}
      </div>
    </div>
  )
}

export function EmptyState({ children }: { children?: ReactNode }) {
  return (
    <div className="empty">
      <svg viewBox="0 0 120 60" width="120" height="60" aria-hidden="true" fill="none" stroke="var(--accent)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
        <path d="M6 44 C 40 44, 70 20, 114 20" />
        <path d="M6 54 C 40 54, 70 30, 114 30" />
        <path d="M24 42 L 22 56 M48 38 L 46 52 M72 28 L 70 42 M96 22 L 94 36" />
      </svg>
      <p>Nothing here yet.</p>
      {children}
    </div>
  )
}
