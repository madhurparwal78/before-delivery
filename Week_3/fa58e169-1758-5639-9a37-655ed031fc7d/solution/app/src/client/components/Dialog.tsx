import { useEffect, useRef, type ReactNode } from 'react'

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'

/** A modal dialog: Tab wraps inside, Escape closes, focus returns to the opener. */
export function Dialog({ label, onClose, children }: { label: string; onClose(): void; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null)
  const opener = useRef<Element | null>(document.activeElement)
  const close = useRef(onClose)
  close.current = onClose

  useEffect(() => {
    const first = box.current?.querySelector<HTMLElement>('[autofocus], input, textarea, select') ?? box.current?.querySelector<HTMLElement>(FOCUSABLE)
    first?.focus()
    const origin = opener.current
    return () => { if (origin instanceof HTMLElement) origin.focus() }
  }, [])

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      close.current()
      return
    }
    if (event.key !== 'Tab') return
    const items = [...(box.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])]
    if (!items.length) return event.preventDefault()
    const at = items.indexOf(document.activeElement as HTMLElement)
    const next = event.shiftKey ? (at <= 0 ? items.length - 1 : at - 1) : (at === items.length - 1 ? 0 : at + 1)
    event.preventDefault()
    items[next].focus()
  }

  return (
    <div className="scrim">
      <div className="dialog" role="dialog" aria-modal="true" aria-label={label} ref={box} onKeyDown={onKeyDown}>
        {children}
      </div>
    </div>
  )
}
