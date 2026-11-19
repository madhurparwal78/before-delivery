import { useEffect, useRef } from 'react'

// Escape closes the top sheet, dialog or menu and returns focus to the control that opened it.

interface Layer { close: () => void; opener: HTMLElement | null }

const layers: Layer[] = []

export function installEscape(): void {
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || layers.length === 0) return
    event.preventDefault()
    event.stopPropagation()
    layers[layers.length - 1].close()
  }, true)
}

export function useLayer(close: () => void, returnTo: HTMLElement | null = null): void {
  const latest = useRef(close)
  latest.current = close
  useEffect(() => {
    const opener = returnTo ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null)
    const layer: Layer = { close: () => latest.current(), opener }
    layers.push(layer)
    return () => {
      layers.splice(layers.indexOf(layer), 1)
      if (opener !== null && opener.isConnected) opener.focus({ preventScroll: true })
    }
  }, [])
}

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'

// Keeps Tab inside a container: the walkthrough, sign-in and `Sign in again` keep focus inside themselves.
export function trapFocus(event: React.KeyboardEvent, container: HTMLElement | null): void {
  if (event.key !== 'Tab' || container === null) return
  const items = [...container.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(item => item.offsetParent !== null)
  if (items.length === 0) {
    event.preventDefault()
    return
  }
  const first = items[0]
  const last = items[items.length - 1]
  if (event.shiftKey && (document.activeElement === first || !container.contains(document.activeElement))) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && (document.activeElement === last || !container.contains(document.activeElement))) {
    event.preventDefault()
    first.focus()
  }
}
