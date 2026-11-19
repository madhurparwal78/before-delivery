import { TAP_SLOP_PX } from './constants'

interface GestureHandlers {
  pan(dxPx: number, dyPx: number): void
  zoom(factor: number): void
  rotate(deltaDeg: number): void
  tap(event: PointerEvent): void
}

interface Contact { x: number; y: number }

// Mouse: drag pans, wheel zooms, right-drag rotates. Touch: one finger pans, two fingers pinch and twist.
export function attachGestures(element: Element, handlers: GestureHandlers): () => void {
  const contacts = new Map<number, Contact>()
  let origin: Contact | null = null
  let travelled = 0
  let rightDrag = false

  const pair = (): [Contact, Contact] | null => {
    const [first, second] = [...contacts.values()]
    return second === undefined ? null : [first, second]
  }

  const down = (event: Event): void => {
    const e = event as PointerEvent
    element.setPointerCapture(e.pointerId)
    contacts.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (contacts.size === 1) {
      origin = { x: e.clientX, y: e.clientY }
      travelled = 0
      rightDrag = e.pointerType === 'mouse' && e.button === 2
    } else {
      travelled = Infinity
    }
  }

  const move = (event: Event): void => {
    const e = event as PointerEvent
    const before = contacts.get(e.pointerId)
    if (before === undefined) return
    const beforePair = pair()
    const next = { x: e.clientX, y: e.clientY }
    contacts.set(e.pointerId, next)
    const dx = next.x - before.x
    const dy = next.y - before.y
    if (contacts.size === 1) {
      travelled += Math.hypot(dx, dy)
      if (origin !== null && Math.hypot(next.x - origin.x, next.y - origin.y) > TAP_SLOP_PX) travelled = Infinity
      if (rightDrag) handlers.rotate(-dx * 0.35)
      else handlers.pan(dx, dy)
      return
    }
    const afterPair = pair()
    if (beforePair === null || afterPair === null) return
    const span = (p: [Contact, Contact]): number => Math.hypot(p[1].x - p[0].x, p[1].y - p[0].y)
    const angle = (p: [Contact, Contact]): number => Math.atan2(p[1].y - p[0].y, p[1].x - p[0].x)
    if (span(beforePair) > 0 && span(afterPair) > 0) handlers.zoom(span(afterPair) / span(beforePair))
    let turn = ((angle(afterPair) - angle(beforePair)) * 180) / Math.PI
    if (turn > 180) turn -= 360
    if (turn < -180) turn += 360
    handlers.rotate(-turn)
  }

  const up = (event: Event): void => {
    const e = event as PointerEvent
    if (contacts.size === 1 && travelled <= TAP_SLOP_PX && e.type === 'pointerup' && e.button === 0) handlers.tap(e)
    contacts.delete(e.pointerId)
    if (contacts.size === 0) origin = null
  }

  const wheel = (event: Event): void => {
    const e = event as WheelEvent
    e.preventDefault()
    handlers.zoom(Math.exp(-e.deltaY * 0.0015))
  }

  const menu = (event: Event): void => event.preventDefault()

  element.addEventListener('pointerdown', down)
  element.addEventListener('pointermove', move)
  element.addEventListener('pointerup', up)
  element.addEventListener('pointercancel', up)
  element.addEventListener('wheel', wheel, { passive: false })
  element.addEventListener('contextmenu', menu)
  return () => {
    element.removeEventListener('pointerdown', down)
    element.removeEventListener('pointermove', move)
    element.removeEventListener('pointerup', up)
    element.removeEventListener('pointercancel', up)
    element.removeEventListener('wheel', wheel)
    element.removeEventListener('contextmenu', menu)
  }
}
