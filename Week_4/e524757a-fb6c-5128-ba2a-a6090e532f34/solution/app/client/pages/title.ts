/** `/`: the split headline around the live viewfinder holding Wump, the pinned reel and the islands. */
import '../styles/title.css'
import { accountMenu } from '../components/account-menu'
import { wumpFallback, type WumpDrawing } from '../components/wump-fallback'
import { createGuideScene, webglAvailable } from '../engine'
import type { GuideScene, GuideView } from '../engine/api'
import { h, reducedMotion, svg } from '../lib/dom'
import { figure } from '../lib/figure'
import { soundButton, releaseSoundButton } from '../lib/sound'
import { status } from '../lib/status'
import { animate, type Running } from '../lib/tween'
import type { Mounted, PageContext } from '../lib/router'
import { ISLANDS, creaturesOfIsland, tileKind, GRID, type Island } from '../../shared/island'

const SPIN_STEP = 15
const ZOOM_STEP = 0.25
const ZOOM_MIN = 0.5
const ZOOM_MAX = 2
const DRAG_PX_PER_STEP = 20
const STRETCH_PX = 200
const PINCH_PX = 40
const HOP_MS = 400
const SPRING_MS = 500

/** The lens steps and focus distances the reel's demo sliders choose between. */
const DEMO_ZOOMS = [1, 2, 4]
const DEMO_FOCUSES = [2, 4, 8, 16]
/** Wump's scene zoom for each lens step. */
const DEMO_SCENE_ZOOM: Record<number, number> = { 1: 0.8, 2: 1.2, 4: 1.8 }

const clamp = (n: number, low: number, high: number): number => Math.min(high, Math.max(low, n))

/** The drawn viewfinder for a guide: a WebGL scene, or Wump in SVG without WebGL. */
function viewfinderPicture(host: HTMLElement): { set(view: GuideView): void; frame(now: number): void; dispose(): void; drawn: boolean } {
  if (webglAvailable()) {
    const canvas = h('canvas', { 'aria-hidden': 'true' })
    host.prepend(canvas)
    const scene: GuideScene = createGuideScene(canvas)
    const fit = (): void => {
      const box = host.getBoundingClientRect()
      if (box.width > 0) scene.resize(Math.round(box.width), Math.round(box.height))
    }
    fit()
    const observer = new ResizeObserver(fit)
    observer.observe(host)
    return { set: (view) => scene.set(view), frame: (now) => scene.frame(now), dispose: () => { observer.disconnect(); scene.dispose() }, drawn: true }
  }
  const drawing: WumpDrawing = wumpFallback()
  host.prepend(drawing.el)
  return { set: drawing.set, frame: () => undefined, dispose: () => undefined, drawn: false }
}

function corners(): HTMLElement {
  return h('div', { class: 'corners-lock', 'aria-hidden': 'true' }, h('i'), h('i'), h('i'), h('i'))
}

/** Wump in the hero: the `application "Guide creature"`. */
function guideCreature(note: ReturnType<typeof status>): { el: HTMLElement; reset(): void; frame(now: number): void; dispose(): void } {
  const el = h('div', {
    class: 'viewfinder', role: 'application', 'aria-label': 'Guide creature', tabindex: '0',
    'aria-describedby': 'guide-help', 'data-state': 'loading',
  })
  const view = { spin: 0, zoom: 1, stretch: 0, hop: 0 }
  let nudges = 0
  let spring: Running | null = null
  let hopping: Running | null = null
  let dirty = true

  const publish = (): void => {
    el.dataset.spin = String(view.spin)
    el.dataset.zoom = view.zoom.toFixed(2)
    el.dataset.stretch = view.stretch.toFixed(2)
    el.dataset.nudges = String(nudges)
    dirty = true
  }
  const turn = (to: number): void => { view.spin = ((to % 360) + 360) % 360; publish() }
  const say = (message: string): void => note.say(message)

  const picture = viewfinderPicture(el)
  el.append(corners())
  el.dataset.state = picture.drawn ? 'ready' : 'still'
  publish()

  const release = (): void => {
    spring?.cancel()
    const from = view.stretch
    if (from === 0) return
    if (reducedMotion()) { view.stretch = 0; publish(); say('Wump is back at rest.'); return }
    spring = animate(SPRING_MS, (p) => { view.stretch = from * (1 - p); publish() })
    spring.finished.then(() => { if (view.stretch === 0) say('Wump is back at rest.') })
  }
  const reset = (): void => {
    spring?.cancel()
    hopping?.cancel()
    view.spin = 0; view.zoom = 1; view.stretch = 0; view.hop = 0
    publish()
    say('Wump is back at rest.')
  }
  const nudge = (): void => {
    nudges += 1
    publish()
    say('Wump hops.')
    if (reducedMotion()) return
    hopping?.cancel()
    hopping = animate(HOP_MS, (p) => { view.hop = Math.sin(Math.PI * p); dirty = true }, (t) => t)
  }
  const zoomBy = (delta: number): void => {
    view.zoom = clamp(view.zoom + delta, ZOOM_MIN, ZOOM_MAX)
    publish()
    say(`Wump at ${Math.round(view.zoom * 100)} percent.`)
  }
  const spinBy = (delta: number): void => { turn(view.spin + delta); say(`Wump faces ${view.spin} degrees.`) }

  el.addEventListener('keydown', (event) => {
    const handled = ((): boolean => {
      switch (event.key) {
        case 'ArrowLeft': case 'q': case 'Q': spinBy(-SPIN_STEP); return true
        case 'ArrowRight': case 'e': case 'E': spinBy(SPIN_STEP); return true
        case '+': case '=': zoomBy(ZOOM_STEP); return true
        case '-': case '_': zoomBy(-ZOOM_STEP); return true
        case ' ': nudge(); return true
        case 'Home': reset(); return true
        default: return false
      }
    })()
    if (handled) event.preventDefault()
  })

  const pointers = new Map<number, { x: number; y: number }>()
  let drag: { x: number; y: number; spin: number } | null = null
  let pinch: { distance: number; zoom: number } | null = null
  const spread = (): number => {
    const [a, b] = [...pointers.values()]
    return Math.hypot((a?.x ?? 0) - (b?.x ?? 0), (a?.y ?? 0) - (b?.y ?? 0))
  }
  el.addEventListener('pointerdown', (event) => {
    el.setPointerCapture(event.pointerId)
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
    if (pointers.size === 1) {
      spring?.cancel()
      drag = { x: event.clientX, y: event.clientY, spin: view.spin }
    } else if (pointers.size === 2) {
      drag = null
      pinch = { distance: spread(), zoom: view.zoom }
    }
  })
  el.addEventListener('pointermove', (event) => {
    const known = pointers.get(event.pointerId)
    if (!known) return
    known.x = event.clientX
    known.y = event.clientY
    if (pinch && pointers.size >= 2) {
      const steps = Math.trunc((spread() - pinch.distance) / PINCH_PX)
      const next = clamp(pinch.zoom + steps * ZOOM_STEP, ZOOM_MIN, ZOOM_MAX)
      if (next !== view.zoom) { view.zoom = next; publish(); say(`Wump at ${Math.round(view.zoom * 100)} percent.`) }
    } else if (drag) {
      const dx = event.clientX - drag.x
      const dy = event.clientY - drag.y
      turn(drag.spin + SPIN_STEP * Math.trunc(dx / DRAG_PX_PER_STEP))
      view.stretch = Math.min(1, Math.hypot(dx, dy) / STRETCH_PX)
      publish()
    }
  })
  const lift = (event: PointerEvent): void => {
    if (!pointers.delete(event.pointerId)) return
    if (pointers.size < 2) pinch = null
    if (pointers.size === 0) { drag = null; release() }
  }
  el.addEventListener('pointerup', lift)
  el.addEventListener('pointercancel', lift)

  const frame = (now: number): void => {
    if (dirty) { picture.set({ ...view }); dirty = false }
    picture.frame(now)
  }
  return { el, reset, frame, dispose: () => { spring?.cancel(); hopping?.cancel(); picture.dispose() } }
}

const REEL_STATEMENTS = [
  'Zoom in on a creature that keeps its own route.',
  'Pull focus until it is sharp and the frame corners lock.',
  'The server scores the photo and fills a page in your album.',
]
const REEL_STATES = ['Zoom 2, focus 16', 'Zoom 2, focus 4', 'Score 100 / 100']

/** The pinned reel: a working camera fragment, its score breakdown and an album page, stepped by scroll. */
function reel(sound: HTMLButtonElement, resetGuide: () => void): { el: HTMLElement; frame(now: number): void; dispose(): void } {
  const frameHost = h('div', { class: 'fragment-frame' })
  const picture = viewfinderPicture(frameHost)
  frameHost.append(corners())
  const zoomFigure = figure('reel-zoom', (n) => `${n}x`, 1)
  const focusFigure = figure('reel-focus', (n) => String(n), 16)
  const zoomSlider = h('input', { type: 'range', id: 'demo-zoom', min: '0', max: String(DEMO_ZOOMS.length - 1), step: '1', value: '0', 'aria-label': 'Demo zoom' })
  const focusSlider = h('input', { type: 'range', id: 'demo-focus', min: '0', max: String(DEMO_FOCUSES.length - 1), step: '1', value: String(DEMO_FOCUSES.length - 1), 'aria-label': 'Demo focus' })
  const view: GuideView = { spin: 30, zoom: 0.8, stretch: 0, hop: 0, focus: 16 }
  let dirty = true

  const applyLens = (): void => {
    const zoom = DEMO_ZOOMS[Number(zoomSlider.value)] ?? 1
    const focus = DEMO_FOCUSES[Number(focusSlider.value)] ?? 16
    view.zoom = DEMO_SCENE_ZOOM[zoom] ?? 1
    view.focus = focus
    dirty = true
    zoomSlider.setAttribute('aria-valuetext', `${zoom}x`)
    focusSlider.setAttribute('aria-valuetext', `${focus} tiles`)
    zoomFigure.set(zoom)
    focusFigure.set(focus)
  }
  zoomSlider.addEventListener('input', applyLens)
  focusSlider.addEventListener('input', applyLens)

  const totals = { size: figure('reel-size', String, 0), centring: figure('reel-centring', String, 0), facing: figure('reel-facing', String, 0), sharpness: figure('reel-sharpness', String, 0), total: figure('reel-total', (n) => `${n} / 100`, 0) }
  const score = h('div', { class: 'fragment', 'data-ui': 'score' },
    h('h3', null, 'Photo score'),
    h('div', { class: 'score-rows' },
      h('div', null, h('span', null, 'Size'), totals.size.el),
      h('div', null, h('span', null, 'Centring'), totals.centring.el),
      h('div', null, h('span', null, 'Facing'), totals.facing.el),
      h('div', null, h('span', null, 'Sharpness'), totals.sharpness.el),
      h('div', { class: 'total' }, h('span', null, 'Total'), totals.total.el)))
  const pages = figure('reel-pages', (n) => `${n} of 4 pages`, 0)
  const newt = creaturesOfIsland(1)
  const tiles = newt.map((creature, index) => h('li', { 'data-filled': index === 0 ? 'false' : 'true' }, creature.name, h('small', null, index === 0 ? 'Not photographed yet.' : 'Filled')))
  const album = h('div', { class: 'fragment', 'data-ui': 'album' },
    h('h3', null, 'Album page'),
    h('p', { class: 'row' }, h('strong', null, 'Saltmarsh Harbour'), pages.el),
    h('ul', { class: 'album-tiles' }, ...tiles))
  pages.set(3, { instant: true })

  const camera = h('div', { class: 'fragment', 'data-ui': 'camera' },
    h('h3', null, 'Working camera'),
    frameHost,
    h('div', { class: 'readouts' },
      h('div', { class: 'demo-readout' }, h('span', null, 'Zoom'), zoomFigure.el),
      h('div', { class: 'demo-readout' }, h('span', null, 'Focus'), focusFigure.el)),
    h('div', { class: 'controls' },
      h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn', onclick: resetGuide }, 'Reset view'), sound),
      h('div', { class: 'slider-field' }, h('label', { for: 'demo-zoom' }, 'Demo zoom'), zoomSlider),
      h('div', { class: 'slider-field' }, h('label', { for: 'demo-focus' }, 'Demo focus'), focusSlider)))
  applyLens()

  const showScore = (on: boolean): void => {
    totals.size.set(on ? 30 : 0); totals.centring.set(on ? 25 : 0); totals.facing.set(on ? 25 : 0)
    totals.sharpness.set(on ? 20 : 0); totals.total.set(on ? 100 : 0)
    pages.set(on ? 4 : 3)
    tiles[0]?.setAttribute('data-filled', String(on))
    const small = tiles[0]?.querySelector('small')
    if (small) small.textContent = on ? 'Filled' : 'Not photographed yet.'
  }

  const items = REEL_STATEMENTS.map((text, index) => h('li', null, h('p', null, text), h('p', { class: 'step-state' }, REEL_STATES[index])))
  const steps = h('ol', { class: 'reel-steps' }, ...items)
  const section = h('section', { class: 'reel', 'aria-label': 'How a photo works' }, h('div', { class: 'reel-pin' }, camera, score, album), steps)

  const setStep = (step: number): void => {
    items.forEach((item, index) => (index === step ? item.setAttribute('aria-current', 'step') : item.removeAttribute('aria-current')))
    zoomSlider.value = step >= 0 ? '1' : '0'
    focusSlider.value = step >= 1 ? '1' : String(DEMO_FOCUSES.length - 1)
    applyLens()
    showScore(step >= 2)
  }

  let onScroll: (() => void) | null = null
  if (reducedMotion()) {
    section.classList.add('reel-static')
    zoomSlider.value = '1'
    focusSlider.value = '1'
    applyLens()
    showScore(true)
  } else {
    let current = -2
    onScroll = (): void => {
      const box = section.getBoundingClientRect()
      const travel = box.height - innerHeight
      const progress = travel > 0 ? clamp(-box.top / travel, 0, 1) : 0
      const step = box.top > innerHeight * 0.4 ? -1 : Math.min(items.length - 1, Math.floor(progress * items.length))
      if (step !== current) { current = step; setStep(step) }
    }
    addEventListener('scroll', onScroll, { passive: true })
    onScroll()
  }

  return {
    el: section,
    frame: (now) => {
      if (dirty) { picture.set({ ...view }); dirty = false }
      picture.frame(now)
    },
    dispose: () => {
      if (onScroll) removeEventListener('scroll', onScroll)
      picture.dispose()
    },
  }
}

const PALETTES: Record<number, { land: string; shore: string; rock: string }> = {
  1: { land: '#b6c47a', shore: '#e6d9a8', rock: '#8b8f8a' },
  2: { land: '#6fa05a', shore: '#c9d39a', rock: '#7d8279' },
  3: { land: '#d9c38a', shore: '#f0e3b8', rock: '#6f8b94' },
  4: { land: '#9fb08c', shore: '#d4d7c0', rock: '#8a8478' },
  5: { land: '#c7b98f', shore: '#eadfc0', rock: '#9a9288' },
}

/** An island drawn from its tile data. */
function islandMap(island: Island): SVGElement {
  const palette = PALETTES[island.id] ?? PALETTES[1]!
  const map = svg('svg', { class: 'island-map', viewBox: `0 0 ${GRID} ${GRID}`, role: 'img', 'aria-label': `Map of ${island.name}` },
    svg('rect', { width: String(GRID), height: String(GRID), fill: '#5b9fb5' }))
  for (let y = 0; y < GRID; y += 1) {
    for (let x = 0; x < GRID; x += 1) {
      const kind = tileKind(island, x, y)
      if (kind === 'water') {
        const pond = x > 0 && y > 0 && x < GRID - 1 && y < GRID - 1
        if (pond) map.appendChild(svg('rect', { x: String(x), y: String(y), width: '1.02', height: '1.02', fill: '#7fbad0' }))
        continue
      }
      const edge = x === 1 || y === 1 || x === GRID - 2 || y === GRID - 2
      const fill = kind === 'land' ? (edge ? palette.shore : palette.land) : palette.rock
      map.appendChild(svg('rect', { x: String(x), y: String(y), width: '1.02', height: '1.02', fill: kind === 'lighthouse' ? '#f2f2f2' : fill }))
      if (kind === 'lighthouse') map.appendChild(svg('rect', { x: String(x + 0.25), y: String(y), width: '0.5', height: '1', fill: '#0b0b0c' }))
    }
  }
  return map
}

function islandsSection(): HTMLElement {
  const cards = ISLANDS.map((island) => h('li', { class: 'island-card' },
    islandMap(island),
    h('h3', null, island.name),
    h('ul', null, ...creaturesOfIsland(island.id).map((creature) => h('li', null, `${creature.name}, ${creature.present}`)))))
  return h('section', { class: 'islands', id: 'islands', tabindex: '-1' }, h('h2', null, 'Islands'), h('ul', { class: 'island-grid' }, ...cards))
}

export function mountTitle(context: PageContext): Mounted {
  const guideNote = status('Guide status')
  const guide = guideCreature(guideNote)
  const sound = soundButton()
  const demo = reel(sound, guide.reset)
  const islands = islandsSection()

  const islandsLink = h('a', { href: '#islands' }, 'Islands')
  islandsLink.addEventListener('click', (event) => {
    event.preventDefault()
    islands.scrollIntoView({ behavior: 'auto' })
    islands.focus({ preventScroll: true })
  })

  const header = h('header', { class: 'title-header' },
    h('a', { class: 'wordmark', href: '/' }, 'Hushfoot'),
    h('nav', { class: 'topnav', 'aria-label': 'Site' },
      islandsLink,
      h('a', { href: '/text-world' }, 'Text world'),
      accountMenu(),
      h('a', { class: 'btn btn-primary btn-small', href: '/play' }, 'Start walking')))

  const hero = h('main', { class: 'hero' },
    h('div', { class: 'hero-row' },
      h('h1', { class: 'hero-headline' }, h('span', { class: 'hero-left' }, 'Walk softly'), h('span', { class: 'hero-right' }, 'and bring film.')),
      guide.el),
    h('p', { id: 'guide-help', class: 'visually-hidden' }, 'Arrow keys or Q and E spin Wump, plus and minus zoom, Space nudges, Home resets.'),
    guideNote.el)
  guideNote.el.classList.add('visually-hidden')

  context.root.append(h('div', { class: 'title-page' }, header, hero, demo.el, islands,
    h('footer', { class: 'title-foot' }, 'Marram & Wick Hushfoot. Creatures are only photographed, never caught or harmed.')))

  let id = 0
  const loop = (now: number): void => {
    guide.frame(now)
    demo.frame(now)
    id = requestAnimationFrame(loop)
  }
  id = requestAnimationFrame(loop)

  return {
    unmount: () => {
      cancelAnimationFrame(id)
      guide.dispose()
      demo.dispose()
      releaseSoundButton(sound)
    },
  }
}
