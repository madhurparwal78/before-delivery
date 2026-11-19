/** `/hall/<handle>`: walk a friend's hall, read each photo's server score and like it. */
import '../styles/hall.css'
import { siteHeader } from '../components/site-header'
import { ApiFailure, NetworkFailure, del, get, put } from '../lib/api'
import { h } from '../lib/dom'
import { createHallScene, webglAvailable } from '../engine'
import type { HallScene } from '../engine/api'
import { figure, likesText, type Figure } from '../lib/figure'
import { closeLayer, openLayer, type Layer } from '../lib/layers'
import { openLive } from '../lib/live'
import { navigate, type Mounted, type PageContext } from '../lib/router'
import { session } from '../lib/session'
import { soundButton, releaseSoundButton } from '../lib/sound'
import { status } from '../lib/status'
import { createWalker, type Walk } from './hall-walk'
import type { Graphics, HallFrame, PublicHall } from '../../shared/types'

const ROOM_WIDTH = 6
const ROOM_DEPTH = 14
const ZOOM_MAX = 4
const PRESETS: readonly string[] = ['full', 'balanced', 'light']

const insideRoom = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < ROOM_WIDTH && y < ROOM_DEPTH

/** The photo viewer: `+` and `-` step `data-zoom` from 1 to 4; Escape closes. */
function photoViewer(frame: HallFrame, opener: HTMLElement): void {
  let zoom = 1
  const image = h('img', { src: frame.photo.image_url, alt: `${frame.photo.creature_name} photo` })
  const stage = h('div', { class: 'stage' }, image)
  const apply = (next: number): void => {
    zoom = Math.min(ZOOM_MAX, Math.max(1, next))
    dialog.dataset.zoom = String(zoom)
    image.style.width = `${zoom * 100}%`
  }
  const closeButton = h('button', { type: 'button', class: 'btn' }, 'Close')
  const dialog = h('div', { class: 'viewer', role: 'dialog', 'aria-label': 'Photo viewer', 'data-zoom': '1', tabindex: '-1' },
    h('div', { class: 'bar' }, h('strong', null, `${frame.photo.creature_name}, ${frame.photo.score.total} points`), closeButton),
    stage,
    h('div', { class: 'bar' },
      h('span', null, frame.caption),
      h('span', { class: 'row' },
        h('button', { type: 'button', class: 'btn', onclick: () => apply(zoom - 1) }, 'Zoom out'),
        h('button', { type: 'button', class: 'btn', onclick: () => apply(zoom + 1) }, 'Zoom in'))))
  const backdrop = h('div', { class: 'viewer-backdrop' })
  const layer: Layer = { el: dialog, modal: true, opener, dismiss: () => close(), initial: () => closeButton }
  const close = (): void => { dialog.remove(); backdrop.remove(); closeLayer(layer) }
  closeButton.addEventListener('click', close)
  backdrop.addEventListener('click', close)
  dialog.addEventListener('keydown', (event) => {
    if (event.key === '+' || event.key === '=') apply(zoom + 1)
    else if (event.key === '-') apply(zoom - 1)
  })
  const layers = document.getElementById('layers') as HTMLElement
  layers.append(backdrop, dialog)
  openLayer(layer)
}

export function mountHallVisit(context: PageContext): Mounted {
  const handle = decodeURIComponent(context.params[0] ?? '')
  const note = status('Gallery status', 5)
  const body = h('main', { class: 'page' })
  context.root.append(siteHeader(), body)
  let teardown: () => void = () => undefined
  let gone = false

  const mountHall = (hall: PublicHall): void => {
    const me = session.me
    const own = me?.player.handle === hall.handle
    const requested = context.query.get('gfx')
    const preset: Graphics = (requested && PRESETS.includes(requested) ? requested : me?.settings.graphics ?? 'full') as Graphics
    const hallEl = h('div', {
      class: 'gallery-hall', role: 'application', 'aria-label': 'Gallery hall', tabindex: '0',
      'data-step': '0', 'data-tile': '2,13', 'data-heading': 'N', 'data-gait': 'idle', 'data-preset': preset, 'data-state': 'loading',
    })
    const likeFigures = new Map<string, Figure>()
    const likeButtons = new Map<string, HTMLButtonElement>()

    const items = hall.frames.map((frame) => {
      const likes = figure('likes', likesText, frame.likes)
      likeFigures.set(frame.photo.id, likes)
      const name = `${frame.photo.creature_name} photo`
      const view = h('button', { type: 'button', class: 'btn', 'aria-label': `View ${name}` }, 'View')
      view.addEventListener('click', () => photoViewer(frame, view))
      const tools = h('div', { class: 'tools' }, view)
      if (!own) {
        const like = h('button', { type: 'button', class: 'btn', 'aria-label': `Like ${name}`, 'aria-pressed': String(frame.liked_by_me === true) }, 'Like')
        like.addEventListener('click', () => {
          if (!me) { void navigate(`/signin?next=${encodeURIComponent(location.pathname + location.search)}`); return }
          const pressed = like.getAttribute('aria-pressed') === 'true'
          const call = pressed ? del<{ likes: number; liked: boolean }>(`/api/photos/${frame.photo.id}/like`) : put<{ likes: number; liked: boolean }>(`/api/photos/${frame.photo.id}/like`)
          call.then((answer) => {
            like.setAttribute('aria-pressed', String(answer.liked))
            likes.set(answer.likes)
            note.say(answer.liked ? `Liked ${name}.` : `Like removed from ${name}.`)
          }, (error: unknown) => {
            if (error instanceof ApiFailure || error instanceof NetworkFailure) note.say(error.message, { error: true })
            else throw error
          })
        })
        likeButtons.set(frame.photo.id, like)
        tools.appendChild(like)
      }
      return h('li', { class: 'hung-item', 'data-photo': frame.photo.id },
        h('img', { src: frame.photo.image_url, alt: '', loading: 'lazy' }),
        h('h3', null, frame.photo.creature_name),
        frame.caption ? h('p', { class: 'caption' }, frame.caption) : null,
        h('p', { class: 'meta' }, h('span', null, `Score ${frame.photo.score.total} / 100`), likes.el),
        tools)
    })
    const list = h('ul', { role: 'list', 'aria-label': 'Hung photos', class: 'hung' }, ...items)
    const empty = h('div', { class: 'frame-empty' }, h('span', { class: 'corners' }), h('p', null, 'No photos hung yet.'))
    empty.hidden = hall.frames.length > 0
    const sound = soundButton()

    body.append(
      h('h1', null, `${hall.owner_name}'s hall`),
      h('div', { class: 'hall-bar' }, sound, own ? h('a', { href: '/hall' }, 'Edit your hall') : null),
      note.el,
      h('div', { class: 'visit' }, hallEl, h('section', null, list, empty)))

    let scene: HallScene | null = null
    let id = 0
    if (webglAvailable()) {
      const canvas = h('canvas', { 'aria-hidden': 'true' })
      hallEl.prepend(canvas)
      const made = createHallScene(canvas)
      scene = made
      const fit = (): void => {
        const box = hallEl.getBoundingClientRect()
        if (box.width > 0) made.resize(Math.round(box.width), Math.round(box.height))
      }
      fit()
      new ResizeObserver(fit).observe(hallEl)
      made.setPreset(preset)
      made.setFrames(hall.frames.map((frame) => ({ url: frame.photo.image_url, caption: frame.caption, creatureName: frame.photo.creature_name })))
      hallEl.dataset.state = 'ready'
    } else {
      hallEl.append(h('p', { class: 'notice' }, '3D is not available here. The hung photos below are the hall.'))
      hallEl.dataset.state = 'still'
    }

    const w = createWalker({
      start: [2, 13], heading: 'N', readyAt: performance.now(), isLand: insideRoom,
      onStep: (walk: Walk) => {
        hallEl.dataset.step = String(walk.step)
        hallEl.dataset.tile = `${walk.tile[0]},${walk.tile[1]}`
        hallEl.dataset.heading = walk.heading
        hallEl.dataset.gait = walk.gait
        scene?.setVisitor({ tile: walk.tile, heading: walk.heading, gait: walk.gait })
      },
    })
    scene?.setVisitor({ tile: [2, 13], heading: 'N', gait: 'idle' })
    hallEl.addEventListener('keydown', (event) => {
      if (event.repeat) { if (w.keyDown(event.key, performance.now())) event.preventDefault(); return }
      if (!event.altKey && !event.ctrlKey && !event.metaKey && w.keyDown(event.key, performance.now())) event.preventDefault()
    })
    hallEl.addEventListener('keyup', (event) => { if (w.keyUp(event.key, performance.now())) event.preventDefault() })
    hallEl.addEventListener('blur', () => w.release(performance.now()))
    const loop = (now: number): void => {
      w.catchUp(performance.now())
      scene?.frame(now)
      id = requestAnimationFrame(loop)
    }
    id = requestAnimationFrame(loop)

    const live = me ? openLive({ hall: hall.handle }) : null
    live?.on('like', (event) => {
      likeFigures.get(event.photo)?.set(event.likes)
      if (event.visitor === me?.player.id) likeButtons.get(event.photo)?.setAttribute('aria-pressed', String(event.liked))
    })

    teardown = () => {
      cancelAnimationFrame(id)
      live?.close()
      scene?.dispose()
      releaseSoundButton(sound)
    }
    if (gone) teardown()
  }

  get<{ hall: PublicHall }>(`/api/halls/${encodeURIComponent(handle)}`).then(
    ({ hall }) => { if (!gone) mountHall(hall) },
    (error: unknown) => {
      if (!(error instanceof ApiFailure) || error.status !== 404) throw error
      if (gone) return
      body.replaceChildren(h('h1', null, 'No gallery here'), h('p', null, 'This hall is not open to visitors.'), h('a', { class: 'btn', href: '/' }, 'Back to the title screen'))
    },
  )

  return { unmount: () => { gone = true; teardown() } }
}

