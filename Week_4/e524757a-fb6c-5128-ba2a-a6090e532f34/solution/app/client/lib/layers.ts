/** Open sheets and dialogs form a stack: Escape closes the top one, a modal one wraps Tab inside itself,
 *  and closing returns focus to the control that opened it. */

export interface Layer {
  /** The dialog or sheet element (it carries the role and name). */
  el: HTMLElement
  /** Wraps Tab and Shift+Tab inside `el`. */
  modal: boolean
  /** Called for Escape; the owner hides the layer and calls `closeLayer`. */
  dismiss(): void
  /** Focus returns here on close. Defaults to whatever had focus when the layer opened. */
  opener?: HTMLElement | null
  /** The element that takes focus on open; defaults to the first control. */
  initial?: () => HTMLElement | null
}

const stack: Layer[] = []

const FOCUSABLE = 'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"]), [contenteditable="true"]'

/** A radio is a Tab stop only as its group's checked radio, or the group's first when none is checked. */
function radioStop(el: HTMLElement, root: HTMLElement): boolean {
  if (!(el instanceof HTMLInputElement) || el.type !== 'radio' || !el.name) return true
  const group = [...root.querySelectorAll<HTMLInputElement>('input[type="radio"]')].filter((r) => r.name === el.name)
  return el.checked || (!group.some((r) => r.checked) && group[0] === el)
}

/** One Tab stop: the same element, or two radios of one group (the browser enters an unchecked group at either end). */
function sameStop(a: Element | null, b: HTMLElement): boolean {
  if (a === b) return true
  return a instanceof HTMLInputElement && b instanceof HTMLInputElement && a.type === 'radio' && b.type === 'radio' && a.name !== '' && a.name === b.name
}

/** The Tab stops inside `root`, in Tab order. */
function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (el) => el.tabIndex >= 0 && !(el as HTMLButtonElement).disabled && !el.closest('[inert]') && el.getClientRects().length > 0 &&
      getComputedStyle(el).visibility !== 'hidden' && radioStop(el, root),
  )
}

export function openLayer(layer: Layer): void {
  layer.opener ??= document.activeElement instanceof HTMLElement ? document.activeElement : null
  stack.push(layer)
  ;(layer.initial?.() ?? focusables(layer.el)[0] ?? layer.el).focus()
}

/** Remove the layer from the stack and return focus to its opener. Call after hiding it. */
export function closeLayer(layer: Layer): void {
  const at = stack.indexOf(layer)
  if (at < 0) return
  stack.splice(at, 1)
  layer.opener?.focus()
}

function topLayer(): Layer | undefined {
  return stack[stack.length - 1]
}

function onKeydown(event: KeyboardEvent): void {
  const top = topLayer()
  if (!top) return
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    top.dismiss()
  } else if (event.key === 'Tab' && top.modal) {
    const items = focusables(top.el)
    if (items.length === 0) { event.preventDefault(); return }
    const first = items[0] as HTMLElement
    const last = items[items.length - 1] as HTMLElement
    const inside = top.el.contains(document.activeElement)
    if (event.shiftKey && (sameStop(document.activeElement, first) || !inside)) { event.preventDefault(); last.focus() }
    else if (!event.shiftKey && (sameStop(document.activeElement, last) || !inside)) { event.preventDefault(); first.focus() }
  }
}

document.addEventListener('keydown', onKeydown, true)
