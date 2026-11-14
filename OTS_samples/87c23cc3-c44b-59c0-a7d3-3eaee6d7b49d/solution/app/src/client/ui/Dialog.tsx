import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from 'react'

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'

function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((element) => element.getClientRects().length > 0)
}

/** Keeps Tab and Shift+Tab inside the element: wraps at either end. */
export function wrapTab(event: KeyboardEvent<HTMLElement>, root: HTMLElement): void {
  if (event.key !== 'Tab') return
  const items = focusables(root)
  const first = items[0]
  const last = items[items.length - 1]
  if (!first || !last) {
    event.preventDefault()
    return
  }
  const active = document.activeElement
  if (event.shiftKey && (active === first || !root.contains(active))) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && (active === last || !root.contains(active))) {
    event.preventDefault()
    first.focus()
  }
}

interface DialogProps {
  /** The accessible name, shown as the heading. */
  name: string
  role?: 'dialog' | 'alertdialog'
  onClose: () => void
  children: ReactNode
  /** A bottom sheet on phones. */
  sheet?: boolean
  className?: string
}

/** A modal dialog: focus goes to its first field, Tab stays inside, Escape closes, focus returns to the opener. */
export function Dialog({ name, role = 'dialog', onClose, children, sheet = false, className = '' }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null)
  const headingId = useId()
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useEffect(() => {
    const dialog = ref.current as HTMLDialogElement
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    dialog.showModal()
    const fields = focusables(dialog).filter((element) => !element.hasAttribute('data-dialog-close'))
    const first = dialog.querySelector<HTMLElement>('[autofocus]') ?? fields.find((element) => element.matches('input, textarea, select')) ?? fields[0] ?? focusables(dialog)[0]
    first?.focus()
    return () => {
      dialog.close()
      opener?.focus()
    }
  }, [])

  return (
    <dialog
      ref={ref}
      role={role === 'alertdialog' ? 'alertdialog' : undefined}
      aria-labelledby={headingId}
      className={`dialog${sheet ? ' dialog-sheet' : ''} ${className}`.trim()}
      onCancel={(event) => {
        event.preventDefault()
        closeRef.current()
      }}
      onKeyDown={(event) => wrapTab(event, event.currentTarget)}
    >
      <h2 id={headingId} className="dialog-title">
        {name}
      </h2>
      {children}
    </dialog>
  )
}
