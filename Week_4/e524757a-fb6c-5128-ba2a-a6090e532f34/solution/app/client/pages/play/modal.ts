/** A centred modal dialog on the dialog layer: opens with focus on its first control, wraps Tab, Escape closes,
 *  focus returns to the opener. Closed dialogs are `hidden`, so they leave the accessibility tree and the Tab order. */
import { h, type Child } from '../../lib/dom'
import { closeLayer, openLayer, type Layer } from '../../lib/layers'

export interface Modal {
  /** The element carrying the role and name. */
  el: HTMLElement
  open(opener?: HTMLElement | null): void
  close(): void
  readonly isOpen: boolean
  /** Remove it from the page (leaving the play page). */
  destroy(): void
}

export function modal(options: {
  name: string
  role?: 'dialog' | 'alertdialog'
  title?: string
  body: Child[]
  initial?: () => HTMLElement | null
  onOpen?: () => void
  onClose?: () => void
}): Modal {
  const dialog = h('div', { role: options.role ?? 'dialog', 'aria-label': options.name, class: 'modal' },
    options.title ? h('h2', { class: 'modal-title' }, options.title) : null, ...options.body)
  const veil = h('div', { class: 'modal-veil', hidden: true }, dialog)
  document.getElementById('layers')?.appendChild(veil)
  const layer: Layer = {
    el: dialog,
    modal: true,
    initial: options.initial,
    dismiss: () => api.close(),
  }
  const api: Modal = {
    el: dialog,
    destroy() {
      if (!veil.hidden) closeLayer(layer)
      veil.remove()
    },
    get isOpen() { return !veil.hidden },
    open(opener) {
      if (!veil.hidden) return
      options.onOpen?.()
      veil.hidden = false
      layer.opener = opener ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null)
      openLayer(layer)
    },
    close() {
      if (veil.hidden) return
      veil.hidden = true
      closeLayer(layer)
      options.onClose?.()
    },
  }
  return api
}
