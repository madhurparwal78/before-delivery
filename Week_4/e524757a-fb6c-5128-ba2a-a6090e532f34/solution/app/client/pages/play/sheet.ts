/** Sheets slide in and out by script on page time (under a third of a second); closed ones are `hidden`. */
import { glide, type Running } from '../../lib/tween'

const SHEET_MS = 280

/** Below 768 px a sheet rises from the bottom; from 768 px it comes in from the right. */
const bottomSheets = (): boolean => !matchMedia('(min-width: 768px)').matches
/** From 1200 px the map and album share one non-modal right panel. */
export const widePanel = (): boolean => matchMedia('(min-width: 1200px)').matches

export class Sheet {
  private running: Running | null = null

  constructor(readonly el: HTMLElement) {
    el.hidden = true
  }

  /** A closing sheet is already closed: out of the accessibility tree and the Tab order while it slides away. */
  get open(): boolean {
    return !this.el.hidden && !this.el.inert
  }

  show(): void {
    this.running?.cancel()
    const axis = bottomSheets() ? 'Y' : 'X'
    this.el.hidden = false
    this.el.inert = false
    this.el.removeAttribute('aria-hidden')
    this.running = glide(SHEET_MS, (p) => {
      this.el.style.transform = p >= 1 ? '' : `translate${axis}(${(1 - p) * 100}%)`
    })
  }

  hide(): void {
    this.running?.cancel()
    const axis = bottomSheets() ? 'Y' : 'X'
    this.el.inert = true
    this.el.setAttribute('aria-hidden', 'true')
    const running = glide(SHEET_MS, (p) => {
      if (p >= 1) {
        this.el.hidden = true
        this.el.style.transform = ''
      } else {
        this.el.style.transform = `translate${axis}(${p * 100}%)`
      }
    })
    this.running = running
  }
}
