// Shared interface pieces: the session context, dialogs with focus handling, fields, icons and media queries.

import { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore, type FormEvent, type ReactNode } from 'react'
import type { Session, Snapshot } from './session.js'

export const SessionContext = createContext<Session | null>(null)

export function useSession(): Session {
  const session = useContext(SessionContext)
  if (!session) throw new Error('No session')
  return session
}

export function useSnapshot(): Snapshot {
  const session = useSession()
  return useSyncExternalStore(session.subscribe, session.getSnapshot)
}

export function useMedia(query: string): boolean {
  const subscribe = useCallback((notify: () => void) => {
    const list = window.matchMedia(query)
    list.addEventListener('change', notify)
    return () => list.removeEventListener('change', notify)
  }, [query])
  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches)
}

export const useReducedMotion = (): boolean => useMedia('(prefers-reduced-motion: reduce)')

export function Status({ label, text, visible = false }: { label: string; text: string; visible?: boolean }): ReactNode {
  return (
    <div role="status" aria-label={label} className={visible ? 'status-line' : 'sr-only'} data-empty={text === '' ? 'true' : undefined}>
      {text}
    </div>
  )
}

type IconName = 'play' | 'stop' | 'plus' | 'x' | 'chevron-up' | 'chevron-down' | 'panel-close' | 'panel-open' | 'download' | 'copy' | 'arrow-left' | 'music'

const PATHS: Record<IconName, ReactNode> = {
  play: <path d="M7 5v14l12-7z" fill="currentColor" stroke="none" />,
  stop: <rect x="6" y="6" width="12" height="12" rx="1.5" fill="currentColor" stroke="none" />,
  plus: <path d="M12 5v14M5 12h14" />,
  x: <path d="M6 6l12 12M18 6L6 18" />,
  'chevron-up': <path d="M6 15l6-6 6 6" />,
  'chevron-down': <path d="M6 9l6 6 6-6" />,
  'panel-close': <path d="M5 5h14v14H5zM14 5v14M10 10l2 2-2 2" />,
  'panel-open': <path d="M5 5h14v14H5zM14 5v14M12 10l-2 2 2 2" />,
  download: <path d="M12 4v11M7 11l5 5 5-5M5 20h14" />,
  copy: <path d="M9 9h10v11H9zM5 15V4h10" />,
  'arrow-left': <path d="M19 12H5M11 6l-6 6 6 6" />,
  music: <path d="M9 18V6l10-2v12M9 18a3 3 0 1 1-3-3 3 3 0 0 1 3 3zM19 16a3 3 0 1 1-3-3 3 3 0 0 1 3 3z" />,
}

export function Icon({ name }: { name: IconName }): ReactNode {
  return (
    <svg className="icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {PATHS[name]}
    </svg>
  )
}

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'

function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => !el.closest('[inert]') && el.getClientRects().length > 0)
}

interface DialogProps {
  name: string
  alert?: boolean
  onClose: () => void
  children: ReactNode
  /** The element to focus first; defaults to the first focusable. */
  first?: string
}

/** A modal dialog or sheet: focus moves in, Tab wraps, Escape closes, focus returns to the opener. */
export function Dialog({ name, alert = false, onClose, children, first }: DialogProps): ReactNode {
  const root = useRef<HTMLDivElement>(null)
  const opener = useRef<Element | null>(document.activeElement)
  const [closing, setClosing] = useState(false)
  const labelId = useId()

  const reduced = useReducedMotion()
  const returnFocus = useCallback(() => {
    const target = opener.current
    if (target instanceof HTMLElement && target.isConnected) target.focus()
  }, [])
  const close = useCallback(() => {
    returnFocus()
    if (reduced) onClose()
    else setClosing(true)
  }, [reduced, returnFocus, onClose])
  useLayoutEffect(() => {
    const node = root.current
    if (!node) return
    const target = (first ? node.querySelector<HTMLElement>(first) : null) ?? focusables(node)[0] ?? node
    target.focus()
  }, [first])

  useEffect(() => {
    if (!closing) return
    const node = root.current
    if (!node) return onClose()
    node.addEventListener('animationend', onClose, { once: true })
    const fallback = window.setTimeout(onClose, 400)
    return () => {
      node.removeEventListener('animationend', onClose)
      window.clearTimeout(fallback)
    }
  }, [closing, onClose])

  const onKeyDown = (event: React.KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.stopPropagation()
      close()
    } else if (event.key === 'Tab' && root.current) {
      const items = focusables(root.current)
      const active = document.activeElement
      const firstItem = items[0]
      const lastItem = items[items.length - 1]
      if (!firstItem || !lastItem) {
        event.preventDefault()
      } else if (event.shiftKey && (active === firstItem || !root.current.contains(active))) {
        event.preventDefault()
        lastItem.focus()
      } else if (!event.shiftKey && (active === lastItem || !root.current.contains(active))) {
        event.preventDefault()
        firstItem.focus()
      }
    }
  }

  return (
    <div className="scrim" data-closing={closing || undefined} onKeyDown={onKeyDown}>
      <div ref={root} className="dialog" role={alert ? 'alertdialog' : 'dialog'} aria-modal="true" aria-label={name} tabIndex={-1} data-closing={closing || undefined}>
        <h2 id={labelId} className="dialog-title">{name}</h2>
        <DialogContext.Provider value={close}>{children}</DialogContext.Provider>
      </div>
    </div>
  )
}

const DialogContext = createContext<() => void>(() => undefined)

export const useDialogClose = (): (() => void) => useContext(DialogContext)

export interface FieldErrors {
  [field: string]: string
}

export function ErrorSummary({ errors, fields }: { errors: FieldErrors; fields: Record<string, string> }): ReactNode {
  const keys = Object.keys(errors)
  if (keys.length === 0) return null
  return (
    <div role="alert" className="error-summary">
      <p className="error-title">There is a problem</p>
      <ul>
        {keys.map((key) => (
          <li key={key}>
            <a
              href={`#${fields[key] ?? ''}`}
              onClick={(event) => {
                event.preventDefault()
                document.getElementById(fields[key] ?? '')?.focus()
              }}
            >
              {errors[key]}
            </a>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function FieldError({ id, message }: { id: string; message?: string }): ReactNode {
  return message ? <p id={id} className="field-error"><span className="marker" aria-hidden="true" />{message}</p> : null
}

/** Runs an async submit with the pending flag and the dialog's error summary. */
export function useSubmit(): { pending: boolean; errors: FieldErrors; run: (event: FormEvent, work: () => Promise<void>) => void; fail: (errors: FieldErrors) => void } {
  const [pending, setPending] = useState(false)
  const [errors, setErrors] = useState<FieldErrors>({})
  const mounted = useRef(true)
  useEffect(() => () => void (mounted.current = false), [])
  const run = (event: FormEvent, work: () => Promise<void>): void => {
    event.preventDefault()
    if (pending) return
    setPending(true)
    setErrors({})
    work().finally(() => {
      if (mounted.current) setPending(false)
    })
  }
  return { pending, errors, run, fail: setErrors }
}

/** Transient confirmations drawn for sighted users; the live regions announce the same copy to assistive tech. */
export function Toasts(): ReactNode {
  const { notices } = useSnapshot()
  const [toasts, setToasts] = useState<{ key: number; text: string }[]>([])
  const previous = useRef(notices)
  const counter = useRef(0)
  const timers = useRef<number[]>([])
  useEffect(() => {
    const before = previous.current
    previous.current = notices
    const fresh = (['Holds', 'Score changes', 'Team', 'Parts', 'Sample banks', 'Layout', 'Text', 'History'] as const)
      .filter((k) => notices[k] && notices[k] !== before[k])
      .map((k) => ({ key: (counter.current += 1), text: notices[k] }))
    if (fresh.length === 0) return
    setToasts((current) => [...current, ...fresh].slice(-2))
    const timer = window.setTimeout(() => {
      timers.current = timers.current.filter((t) => t !== timer)
      setToasts((current) => current.filter((t) => !fresh.includes(t)))
    }, 4500)
    timers.current.push(timer)
  }, [notices])
  useEffect(() => () => timers.current.forEach((timer) => window.clearTimeout(timer)), [])
  return (
    <div className="toasts" aria-hidden="true">
      {toasts.map((t) => <p key={t.key} className="toast">{t.text}</p>)}
    </div>
  )
}

/** The small drawing that opens the cards: five staff lines with a clef-height bar (ink, never the accent). */
export function StaveMark(): ReactNode {
  return (
    <svg className="stave-mark" viewBox="0 0 120 28" width="120" height="28" aria-hidden="true" focusable="false">
      <path d="M2 4h116M2 10h116M2 16h116M2 22h116M2 28h116" transform="translate(0 -2)" stroke="currentColor" strokeWidth="1" fill="none" opacity="0.55" />
      <rect x="10" y="2" width="2" height="24" fill="currentColor" />
    </svg>
  )
}

/** A bare stave with one rest: the empty-state drawing (ink and grey, never the accent). */
export function EmptyStave({ children }: { children: ReactNode }): ReactNode {
  return (
    <div className="empty">
      <svg viewBox="0 0 120 40" width="120" height="40" aria-hidden="true" focusable="false">
        <path d="M4 12h112M4 18h112M4 24h112M4 30h112M4 36h112" stroke="currentColor" strokeWidth="1" opacity="0.5" fill="none" />
        <rect x="52" y="18" width="14" height="6" fill="currentColor" />
      </svg>
      <p>{children}</p>
    </div>
  )
}
