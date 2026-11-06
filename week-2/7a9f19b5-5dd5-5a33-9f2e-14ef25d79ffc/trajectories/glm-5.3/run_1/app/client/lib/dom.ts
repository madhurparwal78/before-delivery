/** DOM helpers: element builders, live regions, focus management. */

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, unknown> = {}, children: (Node | string | null | undefined)[] = []): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue
    if (key === 'class') node.className = String(value)
    else if (key === 'text') node.textContent = String(value)
    else if (key === 'html') node.innerHTML = String(value)
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2), value as EventListener)
    } else if (key === 'checked' && value === true) {
      ;(node as HTMLInputElement).checked = true
    } else if (key === 'value') {
      ;(node as HTMLInputElement).value = String(value)
    } else if (value === true) {
      node.setAttribute(key, '')
    } else {
      node.setAttribute(key, String(value))
    }
  }
  for (const child of children) {
    if (child === null || child === undefined) continue
    node.append(child instanceof Node ? child : document.createTextNode(String(child)))
  }
  return node
}

export function status_region(name: string, className = 'status'): HTMLElement {
  return el('div', { role: 'status', 'aria-live': 'polite', 'data-name': name, class: className })
}

export function find_status(name: string): HTMLElement | null {
  return document.querySelector(`[data-name="${name}"]`)
}

export function announce(name: string, message: string): void {
  const node = find_status(name)
  if (node) node.textContent = message
}

/** Focus trap for dialogs: Tab wraps within the element. */
export function trap_focus(container: HTMLElement): (event: KeyboardEvent) => void {
  const handler = (event: KeyboardEvent) => {
    if (event.key !== 'Tab') return
    const focusables = visible_focusables(container)
    if (focusables.length === 0) return
    const first = focusables[0]!
    const last = focusables[focusables.length - 1]!
    const active = document.activeElement
    if (event.shiftKey && (active === first || !container.contains(active))) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && (active === last || !container.contains(active))) {
      event.preventDefault()
      first.focus()
    }
  }
  container.addEventListener('keydown', handler)
  return handler
}

export function visible_focusables(root: ParentNode): HTMLElement[] {
  const nodes = root.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')
  return Array.from(nodes).filter(
    (node) => !node.hasAttribute('disabled') && node.getAttribute('aria-hidden') !== 'true' && node.offsetParent !== null,
  )
}

/** Open a modal dialog with focus and Escape handling. */
export interface DialogHandle {
  close: () => void
}

export function open_dialog(
  dialog: HTMLDialogElement,
  opener: HTMLElement | null,
): DialogHandle {
  dialog.showModal()
  const first = visible_focusables(dialog)[0]
  if (first) first.focus()
  const trap = trap_focus(dialog)
  const on_close = () => {
    dialog.removeEventListener('keydown', trap)
    if (opener && document.contains(opener)) opener.focus()
  }
  dialog.addEventListener('close', on_close, { once: true })
  return {
    close: () => dialog.close(),
  }
}

export function set_light(state: string, mode: string): void {
  const html = document.documentElement
  html.dataset.light = state
  html.dataset.lightMode = mode
}
