/** `region "Safari"`: the code, the sightings, the live feed of the host's photos and End or Leave. Everything a live
 *  change brings is appended in place; lists are never rebuilt while the safari goes on. */
import type { Photo, Safari, Sighting } from '../../../shared/types'
import { h } from '../../lib/dom'
import { log } from '../../lib/status'

interface SafariPanel {
  el: HTMLElement
  /** Show or hide the region for `safari` (null: not in a safari). */
  set(safari: Safari | null): void
  addSighting(sighting: Sighting): void
  addFeed(hostName: string, photo: Photo): void
  readonly sightings: readonly Sighting[]
}

export function safariPanel(options: { playerId: string; onEnd(): void; onLeave(): void }): SafariPanel {
  const code = h('p', { class: 'safari-code' })
  const sightingList = h('ul', { role: 'list', 'aria-label': 'Sightings', class: 'safari-sightings' })
  const feed = log('Safari feed')
  const end = h('button', { type: 'button', class: 'btn btn-small' })
  const el = h('section', { role: 'region', 'aria-label': 'Safari', class: 'safari', hidden: true }, h('div', { class: 'safari-head' }, code, end), sightingList, feed)
  const shown: Sighting[] = []
  const keys = new Set<string>()
  let hosting = false
  end.addEventListener('click', () => (hosting ? options.onEnd() : options.onLeave()))

  const addSighting = (sighting: Sighting): void => {
    const key = `${sighting.island}:${sighting.x}:${sighting.y}:${sighting.by}`
    if (keys.has(key)) return
    keys.add(key)
    shown.push(sighting)
    sightingList.appendChild(h('li', null, `Sighting at ${sighting.x}, ${sighting.y} by ${sighting.by}`))
  }

  return {
    el,
    get sightings() { return shown },
    set(safari) {
      if (!safari || safari.status === 'ended') {
        el.hidden = true
        sightingList.replaceChildren()
        feed.replaceChildren()
        shown.length = 0
        keys.clear()
        return
      }
      const first = el.hidden
      el.hidden = false
      hosting = safari.host.id === options.playerId
      code.textContent = `Safari code ${safari.code}`
      end.textContent = hosting ? 'End safari' : 'Leave safari'
      if (first) for (const sighting of safari.sightings ?? []) addSighting(sighting)
    },
    addSighting,
    addFeed(hostName, photo) {
      feed.appendChild(h('div', { class: 'feed-entry' },
        h('p', null, `${hostName} photographed ${photo.creature_name}: ${photo.score.total} points.`),
        h('img', { src: photo.image_url, alt: `${photo.creature_name} photo by ${hostName}`, width: 960, height: 600, loading: 'lazy' })))
    },
  }
}
