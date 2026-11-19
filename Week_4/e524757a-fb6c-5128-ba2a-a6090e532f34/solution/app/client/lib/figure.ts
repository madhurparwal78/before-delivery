/** Count-up figures: `data-figure`, hidden from assistive technology, counting from the old value to the new over 600 ms. */
import { digits, h, reducedMotion } from './dom'
import { animate } from './tween'

const FIGURE_MS = 600

export interface Figure {
  el: HTMLSpanElement
  /** The value the figure is heading for (its final text). */
  readonly value: number
  /** Count to `next`; `from` overrides the start (a result counts from 0). With `instant` it shows the final text at once. */
  set(next: number, options?: { from?: number; instant?: boolean }): void
}

export function figure(name: string, format: (n: number) => string, initial: number): Figure {
  const el = h('span', { class: 'figure', 'data-figure': name, 'aria-hidden': 'true' })
  let target = initial
  let shown = initial
  let running: { cancel(): void } | null = null
  const paint = (n: number): void => { shown = n; el.replaceChildren(digits(format(n))) }
  paint(initial)
  return {
    el,
    get value() { return target },
    set(next, options = {}) {
      running?.cancel()
      const from = options.from ?? shown
      target = next
      if (options.instant || reducedMotion() || from === next) { paint(next); return }
      paint(from)
      running = animate(FIGURE_MS, (p) => paint(p >= 1 ? next : from + Math.trunc((next - from) * p)))
    },
  }
}

export const frames = (n: number): string => (n === 1 ? '1 frame' : `${n} frames`)
export const stampsText = (n: number): string => (n === 1 ? '1 stamp' : `${n} stamps`)
export const likesText = (n: number): string => (n === 1 ? '1 like' : `${n} likes`)
export const pagesText = (n: number): string => `${n} of 4 pages`
export const outOf100 = (n: number): string => `${n} / 100`
export const plain = (n: number): string => String(n)
