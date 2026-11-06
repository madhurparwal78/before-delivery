/** Small DOM helpers shared by every screen. */

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K, attrs?: Record<string, unknown>, ...children: (Node | string | null | undefined)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined || v === false) continue
      if (k === 'class') node.className = String(v)
      else if (k === 'text') node.textContent = String(v)
      else if (k.startsWith('on') && typeof v === 'function') {
        node.addEventListener(k.slice(2), v as EventListener)
      } else if (v === true) node.setAttribute(k, '')
      else node.setAttribute(k, String(v))
    }
  }
  for (const c of children) {
    if (c === null || c === undefined) continue
    node.append(typeof c === 'string' ? document.createTextNode(c) : c)
  }
  return node
}

export function clear(node: Element): void {
  while (node.firstChild) node.removeChild(node.firstChild)
}

export function visuallyHidden(text: string): HTMLSpanElement {
  return el('span', { class: 'visually-hidden', text })
}

export function setAlert(region: HTMLElement, copy: string): void {
  clear(region)
  region.append(el('p', { text: copy }))
}

export function announce(status: HTMLElement, message: string): void {
  // a polite live region announces once when its text changes
  status.textContent = ''
  requestAnimationFrame(() => { status.textContent = message })
}
