/** What is drawn over the canvas inside the World view: the framing guide with its corners and readouts, the shutter
 *  bars and the pinned `Scoring` thumbnail. All of it moves by script on page time. */
import { h, setDigits } from '../../lib/dom'
import { status, type Status } from '../../lib/status'
import { animate, glide, type Running } from '../../lib/tween'

const GUIDE_MS = 180
const SHUTTER_MS = 210

export interface Overlay {
  el: HTMLElement
  frameGuide: Status
  /** Draw the guide over 180 ms (or cut). `done` runs when it is fully drawn. */
  drawGuide(done: () => void): void
  hideGuide(): void
  /** Corners turn red while a creature is in frame. */
  setLock(locked: boolean): void
  setReadouts(zoom: number, focus: number): void
  /** The bars close and open over 210 ms; `done` runs when they are open again. */
  runShutter(done: () => void): void
  showThumbnail(url: string): void
  hideThumbnail(): void
}

export function buildOverlay(): Overlay {
  const frameGuide = status('Frame guide')
  const zoomValue = h('span', { class: 'readout-value' })
  const focusValue = h('span', { class: 'readout-value' })
  const zoomBox = h('span', { class: 'readout', 'data-readout': 'zoom' }, h('span', { class: 'readout-label' }, 'Zoom'), zoomValue)
  const focusBox = h('span', { class: 'readout', 'data-readout': 'focus' }, h('span', { class: 'readout-label' }, 'Focus'), focusValue)
  const guide = h('div', { class: 'guide', hidden: true },
    h('span', { class: 'guide-corner tl' }), h('span', { class: 'guide-corner tr' }),
    h('span', { class: 'guide-corner bl' }), h('span', { class: 'guide-corner br' }),
    h('span', { class: 'guide-centre' }),
    h('div', { class: 'guide-label' }, frameGuide.el),
    h('div', { class: 'guide-readouts' }, zoomBox, focusBox))
  const barTop = h('div', { class: 'shutter-bar top' })
  const barBottom = h('div', { class: 'shutter-bar bottom' })
  const thumbImage = h('img', { alt: '', class: 'thumb-image' })
  const thumb = h('figure', { class: 'thumb', hidden: true }, thumbImage, h('figcaption', null, 'Scoring'))
  const el = h('div', { class: 'overlay' }, guide, barTop, barBottom, thumb)
  let drawing: Running | null = null
  let shutter: Running | null = null

  const setDraw = (p: number): void => { guide.style.setProperty('--draw', String(p)) }
  return {
    el,
    frameGuide,
    drawGuide(done) {
      drawing?.cancel()
      guide.hidden = false
      setDraw(0)
      drawing = glide(GUIDE_MS, (p) => {
        setDraw(p)
        if (p >= 1) done()
      })
    },
    hideGuide() {
      drawing?.cancel()
      guide.hidden = true
    },
    setLock: (locked) => guide.classList.toggle('lock', locked),
    setReadouts(zoom, focus) {
      setDigits(zoomValue, `${zoom}×`)
      setDigits(focusValue, String(focus))
    },
    runShutter(done) {
      shutter?.cancel()
      shutter = animate(SHUTTER_MS, (p) => {
        const close = p < 0.5 ? p * 2 : (1 - p) * 2
        const size = `${close * 50}%`
        barTop.style.height = barBottom.style.height = p >= 1 ? '0' : size
        if (p >= 1) done()
      }, (t) => t)
    },
    showThumbnail(url) {
      thumbImage.src = url
      thumb.hidden = false
    },
    hideThumbnail() {
      thumb.hidden = true
      thumbImage.removeAttribute('src')
    },
  }
}
