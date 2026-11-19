/** The text world: every island, creature and personal progress as plain headings and lists. */
import '../styles/text-world.css'
import { ApiFailure, NetworkFailure, get, post, put } from '../lib/api'
import { h, setDigits } from '../lib/dom'
import { openLive, tabId, type Live } from '../lib/live'
import { session } from '../lib/session'
import { status } from '../lib/status'
import { frames } from '../lib/figure'
import { HARBOUR, ISLANDS, SPOTS, creaturesOfIsland } from '../../shared/island'
import { FULL_ROLL, type Albums, type Me, type Photo, type Position } from '../../shared/types'

interface Progress {
  position: Position
  film: number
  stamps: number
  lighthouse: 'open' | 'closed'
  pages: Map<number, number>
  best: Map<string, number>
}


const locationLine = (position: Position): string => {
  const island = ISLANDS.find((entry) => entry.id === position.island)
  return `You are on ${island?.name ?? ''} at tile ${position.tile[0]}, ${position.tile[1]}.`
}

function pagesOf(albums: Albums): Map<number, number> {
  return new Map(albums.albums.map((album) => [album.island, album.pages_filled]))
}

function bestOf(photos: Photo[]): Map<string, number> {
  const best = new Map<string, number>()
  for (const photo of photos) best.set(photo.creature, Math.max(best.get(photo.creature) ?? 0, photo.score.total))
  return best
}

export function textWorldContent(options: { live?: Live } = {}): { el: HTMLElement; unmount(): void } {
  const signedIn = session.me !== null
  const root = h('div', { class: 'tw' })
  const note = status('Text world status')
  let live: Live | null = null
  let ownLive = false
  let progress: Progress | null = null
  let line = ''

  const creatureLines = new Map<string, HTMLElement>()
  const pageLines = new Map<number, HTMLElement>()
  const sailButtons = new Map<number, HTMLButtonElement>()
  const stampsLine = h('p')
  const lighthouseLine = h('p')
  const filmLine = h('p')
  const placeLine = h('p')
  const refill = h('button', { type: 'button', class: 'btn' }, 'Refill film')

  function paint(): void {
    for (const island of ISLANDS) {
      for (const creature of creaturesOfIsland(island.id)) {
        const best = progress?.best.get(creature.id)
        const text = !progress ? `${creature.name}: ${creature.present}`
          : best === undefined ? `${creature.name}: ${creature.present}, not photographed yet`
            : `${creature.name}: ${creature.present}, photographed, best ${best} points`
        const el = creatureLines.get(creature.id) as HTMLElement
        if (best === undefined) el.textContent = text
        else setDigits(el, text)
      }
      if (progress) {
        setDigits(pageLines.get(island.id) as HTMLElement, `${progress.pages.get(island.id) ?? 0} of 4 album pages`)
        ;(sailButtons.get(island.id) as HTMLButtonElement).hidden = island.id === progress.position.island
      }
    }
    if (!progress) return
    setDigits(stampsLine, `Stamps: ${progress.stamps}`)
    lighthouseLine.textContent = `Lighthouse: ${progress.lighthouse}`
    setDigits(filmLine, `Film: ${frames(progress.film)}`)
    line = locationLine(progress.position)
    setDigits(placeLine, line)
    refill.disabled = progress.position.island !== HARBOUR || progress.film >= FULL_ROLL
  }

  function move(position: Position): void {
    if (!progress) return
    progress.position = position
    paint()
    note.say(locationLine(position))
  }

  function absorb(albums: Albums): void {
    if (!progress) return
    progress.film = albums.film
    progress.stamps = albums.stamps
    progress.lighthouse = albums.lighthouse
    progress.pages = pagesOf(albums)
  }

  function fail(error: unknown): void {
    if (error instanceof ApiFailure || error instanceof NetworkFailure) note.say(error.message, { error: true })
    else throw error
  }

  for (const island of ISLANDS) {
    const list = h('ul', { class: 'tw-list' })
    for (const creature of creaturesOfIsland(island.id)) {
      const item = h('li', null, `${creature.name}: ${creature.present}`)
      creatureLines.set(creature.id, item)
      list.appendChild(item)
    }
    const section = h('section', { class: 'tw-island' }, h('h2', null, island.name))
    if (signedIn) {
      const sail = h('button', { type: 'button', class: 'btn', hidden: true }, `Sail to ${island.name}`)
      sail.addEventListener('click', () => {
        const spot = SPOTS[0]!
        put<{ position: Position }>('/api/me/position', { island: island.id, tile: spot.tile, heading: spot.heading }, { 'X-Tab-Id': tabId })
          .then((saved) => move(saved.position), fail)
      })
      sailButtons.set(island.id, sail)
      const pages = h('p', { class: 'tw-pages' })
      pageLines.set(island.id, pages)
      section.append(sail, list, pages)
    } else {
      section.append(list)
    }
    root.appendChild(section)
  }

  const progressSection = h('section', { class: 'tw-progress' }, h('h2', null, 'Your progress'))
  if (signedIn) {
    refill.addEventListener('click', () => {
      post<{ film: number }>('/api/me/refill').then((done) => {
        if (progress) progress.film = done.film
        paint()
        note.say(`Film refilled to ${done.film} frames.`)
      }, fail)
    })
    progressSection.append(
      h('div', { class: 'tw-lines' }, stampsLine, lighthouseLine, filmLine, placeLine),
      h('div', { class: 'tw-actions' }, refill),
    )
  } else {
    progressSection.append(h('p', null, 'Sign in to see your progress.'), h('a', { class: 'btn', href: '/signin?next=/text-world' }, 'Sign in'))
  }
  progressSection.appendChild(note.el)
  root.appendChild(progressSection)
  paint()
  // Signed in, the lines grow and the sail buttons appear once progress arrives: show it whole, never shifting.
  root.hidden = signedIn

  async function load(): Promise<void> {
    const [me, albums, photos] = await Promise.all([get<Me>('/api/me'), get<Albums>('/api/me/albums'), get<{ photos: Photo[] }>('/api/me/photos')])
    progress = { position: me.position, film: me.film, stamps: me.stamps, lighthouse: me.lighthouse, pages: pagesOf(albums), best: bestOf(photos.photos) }
    paint()
  }

  if (signedIn) {
    load().finally(() => { root.hidden = false }).then(() => {
      live = options.live ?? openLive()
      ownLive = options.live === undefined
      live.on('progress', (albums) => {
        absorb(albums)
        paint()
        get<{ photos: Photo[] }>('/api/me/photos').then((photos) => {
          if (progress) { progress.best = bestOf(photos.photos); paint() }
        }, fail)
      })
      live.on('position', (event) => {
        if (event.tab !== tabId) move({ island: event.island, tile: event.tile, heading: event.heading })
      })
      live.on('restart', (event) => {
        absorb(event.progress)
        move(event.position)
      })
    }, fail)
  }

  return { el: root, unmount: () => { if (ownLive) live?.close() } }
}
