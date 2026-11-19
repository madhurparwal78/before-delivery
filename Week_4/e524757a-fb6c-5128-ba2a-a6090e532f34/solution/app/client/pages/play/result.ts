/** `dialog "Photo result"`: the server's measurement beside the points, four rows and the total counting up. */
import type { PhotoAnswer } from '../../../shared/types'
import { h } from '../../lib/dom'
import { figure, outOf100, plain } from '../../lib/figure'
import { closeLayer, openLayer, type Layer } from '../../lib/layers'
import { Sheet } from './sheet'

type Kept = PhotoAnswer['photo']

interface ResultSheet {
  show(photo: Kept, opener: HTMLElement | null): void
  close(): void
  readonly isOpen: boolean
  destroy(): void
}

const FACING = { toward: 'faces you', side: 'side-on', away: 'faces away' }

export function resultSheet(options: { onPostcard(photoId: string, creatureName: string, opener: HTMLElement): void }): ResultSheet {
  const title = h('h2', { class: 'sheet-title' })
  const rows = h('dl', { class: 'result-rows' })
  const total = figure('score-total', outOf100, 0)
  const close = h('button', { type: 'button', class: 'btn' }, 'Close')
  const postcard = h('button', { type: 'button', class: 'btn' }, 'Send as postcard')
  const el = h('div', { role: 'dialog', 'aria-label': 'Photo result', class: 'sheet result-sheet' },
    h('header', { class: 'pane-head' }, title, close),
    rows,
    h('p', { class: 'result-total' }, h('span', { class: 'result-total-label' }, 'Total'), total.el),
    h('div', { class: 'pane-actions' }, postcard))
  document.getElementById('layers')?.appendChild(el)
  const sheet = new Sheet(el)
  let current: Kept | null = null
  const layer: Layer = { el, modal: true, initial: () => close, dismiss: () => api.close() }
  const api: ResultSheet = {
    get isOpen() { return sheet.open },
    show(photo, opener) {
      current = photo
      title.textContent = photo.creature_name
      const { score, measures } = photo
      const data: [string, string, number, string][] = [
        ['Size', 'score-size', score.size, `${measures.distance} tiles away, best ${measures.best_distance}`],
        ['Centring', 'score-centring', score.centring, `${measures.offset} tiles off centre`],
        ['Facing', 'score-facing', score.facing, FACING[measures.creature_facing]],
        ['Sharpness', 'score-sharpness', score.sharpness, `focus ${measures.focus_error} tiles off`],
      ]
      rows.replaceChildren(...data.flatMap(([label, name, value, note]) => {
        const f = figure(name, plain, 0)
        f.set(value, { from: 0 })
        return [h('dt', null, label), h('dd', null, f.el, h('span', { class: 'result-note' }, note))]
      }))
      total.set(score.total, { from: 0 })
      layer.opener = opener
      sheet.show()
      openLayer(layer)
    },
    close() {
      if (!sheet.open) return
      sheet.hide()
      closeLayer(layer)
    },
    destroy() {
      if (sheet.open) closeLayer(layer)
      el.remove()
    },
  }
  close.addEventListener('click', () => api.close())
  postcard.addEventListener('click', () => {
    if (current) options.onPostcard(current.id, current.creature_name, postcard)
  })
  return api
}
