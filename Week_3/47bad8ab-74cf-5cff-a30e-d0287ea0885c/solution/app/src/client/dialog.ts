import { type Child, h } from './dom.ts'

export interface OpenDialog {
  element: HTMLDialogElement
  close(): void
}

interface DialogOptions {
  label: string
  content: Child[]
  className?: string
  /** What receives focus on open; defaults to the first control. */
  initialFocus?: () => HTMLElement | null
  /** Where focus returns on close; defaults to the control that opened the dialog. */
  returnFocus?: () => HTMLElement | null
  /** Escape and Close are ignored when false (the name dialog cannot be dismissed). */
  dismissible?: boolean
  onClose?: () => void
}

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'

const focusables = (root: HTMLElement): HTMLElement[] => [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((element) => !element.closest('[inert], [hidden]'))

/** A modal `<dialog>`: Tab and Shift+Tab wrap inside, Escape closes and focus returns to the opener. */
export function openDialog({ label, content, className, initialFocus, returnFocus, dismissible = true, onClose }: DialogOptions): OpenDialog {
  const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
  const element = h('dialog', { 'aria-label': label, class: className ?? 'sheet' }, ...content)
  let closed = false
  const close = (): void => {
    if (closed) return
    closed = true
    element.close()
    element.remove()
    const target = returnFocus?.() ?? opener
    if (target?.isConnected) target.focus()
    onClose?.()
  }
  element.addEventListener('cancel', (event) => {
    event.preventDefault()
    if (dismissible) close()
  })
  element.addEventListener('keydown', (event) => {
    if (event.key !== 'Tab') return
    const items = focusables(element)
    const first = items[0]
    const last = items[items.length - 1]
    if (!first || !last) return event.preventDefault()
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  })
  document.body.append(element)
  element.showModal()
  ;(initialFocus?.() ?? focusables(element)[0] ?? element).focus()
  return { element, close }
}
