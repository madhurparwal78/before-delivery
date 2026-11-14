import { EASE, reducedMotion } from '../motion.ts'

const ENTER_MS = 300
const ROW_STAGGER_MS = 40
const ROW_MS = 200
const DRAW_MS = 400
const FLASH_MS = 600
const GLIDE_MS = 350

function mark(element: Element, attribute: string, value: string, animation: Animation | null, fallbackMs: number): void {
  element.setAttribute(attribute, value)
  const clear = (): void => {
    if (element.getAttribute(attribute) === value) element.removeAttribute(attribute)
  }
  if (animation) animation.finished.then(clear, clear)
  else window.setTimeout(clear, fallbackMs)
}

/** An entity fades and grows into place while its rows fill in one after another. */
export function playEntrance(entity: SVGGElement): void {
  if (reducedMotion()) return
  const node = entity.querySelector('.node')
  if (!node) return
  const grow = node.animate([{ opacity: 0, scale: 0.96 }, { opacity: 1, scale: 1 }], { duration: ENTER_MS, easing: EASE, fill: 'backwards' })
  mark(entity, 'data-motion', 'enter', grow, ENTER_MS)
  entity.querySelectorAll('[data-column]').forEach((row, index) => {
    row.animate([{ opacity: 0 }, { opacity: 1 }], { duration: ROW_MS, delay: ROW_STAGGER_MS * index, easing: EASE, fill: 'backwards' })
  })
}

/** Both endpoint rows light up in a tint of the accent. Under reduced motion the highlight is static. */
function flashRow(row: Element): void {
  const light = row.querySelector('.row-flash')
  if (!reducedMotion()) light?.animate([{ fillOpacity: 0.28 }, { fillOpacity: 0 }], { duration: FLASH_MS, easing: 'ease-out' })
  row.setAttribute('data-flash', 'true')
  window.setTimeout(() => row.removeAttribute('data-flash'), FLASH_MS)
}

/** A new connector draws itself from its first column to its second, then both rows flash. */
export function playDraw(link: SVGGElement, rows: Element[]): void {
  const path = link.querySelector('path')
  if (!reducedMotion() && path instanceof SVGPathElement) {
    const length = path.getTotalLength()
    const draw = path.animate([{ strokeDasharray: length, strokeDashoffset: length }, { strokeDasharray: length, strokeDashoffset: 0 }], {
      duration: DRAW_MS,
      easing: 'ease-out',
      fill: 'backwards',
    })
    mark(link, 'data-motion', 'draw', draw, DRAW_MS)
  }
  for (const row of rows) flashRow(row)
}

/** An entity glides from its old cell to its new one, and its connectors follow. */
export function playGlide(entity: SVGGElement, from: { x: number; y: number }, to: { x: number; y: number }): void {
  if (reducedMotion()) return
  const glide = entity.animate([{ transform: `translate(${from.x}px, ${from.y}px)` }, { transform: `translate(${to.x}px, ${to.y}px)` }], {
    duration: GLIDE_MS,
    easing: EASE,
  })
  mark(entity, 'data-motion', 'move', glide, GLIDE_MS)
}

export function glideConnector(path: SVGPathElement, from: string, to: string): void {
  if (reducedMotion()) return
  path.animate([{ d: `path("${from}")` }, { d: `path("${to}")` }], { duration: GLIDE_MS, easing: EASE })
}
