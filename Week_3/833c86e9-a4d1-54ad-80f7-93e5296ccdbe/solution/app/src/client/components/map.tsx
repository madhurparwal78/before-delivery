import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { countedPhrase } from '../../shared/i18n'
import type { SearchResponse } from '../../shared/types'
import { useApp } from '../state'
import { Money } from '../ui'
import '../styles/map.css'

export interface MapViewState { zoom: number; cx: number; cy: number }
export const DEFAULT_ZOOM = 2
const LABEL_WIDTH = 100
const LABEL_HEIGHT = 44

const MAX_ZOOM = 5
const PLANE = 1000

type Pin = SearchResponse['pins'][number]
interface Item { code: string; x: number; y: number; members: Pin[] }

const round1 = (value: number): number => Math.round(value * 10) / 10
const clamp = (value: number): number => Math.min(PLANE, Math.max(0, value))
const sideOf = (zoom: number): number => PLANE / 2 ** zoom
const sameView = (a: MapViewState, b: MapViewState): boolean => a.zoom === b.zoom && round1(a.cx) === round1(b.cx) && round1(a.cy) === round1(b.cy)

/** Results inside the view, grouped on the published grid: a cell with two or more is one cluster at the mean of its members. */
function itemsIn(pins: Pin[], view: MapViewState): Item[] {
  const half = sideOf(view.zoom) / 2
  const size = 200 / 2 ** view.zoom
  const cells = new Map<string, Pin[]>()
  for (const pin of pins) {
    if (Math.abs(pin.x - view.cx) > half || Math.abs(pin.y - view.cy) > half) continue
    const key = `${Math.floor(pin.x / size)},${Math.floor(pin.y / size)}`
    cells.set(key, [...(cells.get(key) ?? []), pin])
  }
  const mean = (members: Pin[], axis: 'x' | 'y'): number => round1(members.reduce((sum, member) => sum + member[axis], 0) / members.length)
  return [...cells.values()]
    .map((members) => ({
      code: members.map((member) => member.code).sort()[0],
      x: members.length === 1 ? members[0].x : mean(members, 'x'),
      y: members.length === 1 ? members[0].y : mean(members, 'y'),
      members,
    }))
    .sort((a, b) => (a.code < b.code ? -1 : 1))
}

/** The nearest item on the side the arrow points to, among those whose offset along the arrow is at least their offset across it. */
function neighbour(items: Item[], from: Item, key: string): Item | null {
  let best: Item | null = null
  let bestDistance = Infinity
  for (const item of items) {
    if (item.code === from.code) continue
    const dx = item.x - from.x
    const dy = item.y - from.y
    const sides: Record<string, boolean> = { ArrowUp: dy < 0 && -dy >= Math.abs(dx), ArrowDown: dy > 0 && dy >= Math.abs(dx), ArrowLeft: dx < 0 && -dx >= Math.abs(dy), ArrowRight: dx > 0 && dx >= Math.abs(dy) }
    const distance = Math.hypot(dx, dy)
    if (sides[key] && (distance < bestDistance || (distance === bestDistance && best !== null && item.code < best.code))) {
      best = item
      bestDistance = distance
    }
  }
  return best
}

/* The coastline: a closed polygon whose radius is displaced by layered, seeded loop noise, plus a few islands. */
function seeded(text: string): () => number {
  let hash = 1779033703 ^ text.length
  for (let i = 0; i < text.length; i++) {
    hash = Math.imul(hash ^ text.charCodeAt(i), 3432918353)
    hash = (hash << 13) | (hash >>> 19)
  }
  let state = hash
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function loopNoise(random: () => number, cells: number): (t: number) => number {
  const lattice = Array.from({ length: cells }, random)
  return (t) => {
    const at = t * cells
    const index = Math.floor(at)
    const f = at - index
    const blend = f * f * (3 - 2 * f)
    return lattice[index % cells] * (1 - blend) + lattice[(index + 1) % cells] * blend
  }
}

function blob(random: () => number, x: number, y: number, radius: number, points: number, bay = 0): string {
  const layers = [[5, 1], [11, 0.5], [23, 0.25], [47, 0.12]].map(([cells, weight]) => ({ noise: loopNoise(random, cells), weight }))
  const total = layers.reduce((sum, layer) => sum + layer.weight, 0)
  const bayAt = random()
  const coords = Array.from({ length: points }, (_, i) => {
    const t = i / points
    const noise = layers.reduce((sum, layer) => sum + layer.noise(t) * layer.weight, 0) / total
    const away = Math.min(Math.abs(t - bayAt), 1 - Math.abs(t - bayAt))
    const r = radius * (0.5 + 0.95 * noise) * (1 - bay * Math.exp(-((away / 0.07) ** 2)))
    return `${round1(x + r * Math.cos(2 * Math.PI * t))},${round1(y + r * Math.sin(2 * Math.PI * t))}`
  })
  return `M${coords.join('L')}Z`
}

function coastline(code: string, cx: number, cy: number): string {
  const random = seeded(code)
  const parts = [blob(random, cx, cy, 150, 720, 0.3)]
  const islands = 3 + Math.floor(random() * 3)
  for (let i = 0; i < islands; i++) {
    const angle = random() * 2 * Math.PI
    const distance = 200 + random() * 120
    parts.push(blob(random, cx + distance * Math.cos(angle), cy + distance * Math.sin(angle), 14 + random() * 26, 90))
  }
  return parts.join('')
}

interface PlaneProps {
  destination: string
  centre: { x: number; y: number }
  pins: Pin[]
  view: MapViewState
  searched: MapViewState
  selected: string | null
  onView: (view: MapViewState) => void
  onSelect: (code: string) => void
  onOpen: (code: string) => void
  onSearchArea: () => void
}

/** `region "Map"`: the drawn plane with price labels, clusters, pan and zoom buttons and the Search this area button. */
export function MapPlane({ destination, centre, pins, view, searched, selected, onView, onSelect, onOpen, onSearchArea }: PlaneProps) {
  const app = useApp()
  const plane = useRef<HTMLDivElement>(null)
  const zoomIn = useRef<HTMLButtonElement>(null)
  const nodes = useRef(new Map<string, HTMLButtonElement>())
  const drag = useRef<{ x: number; y: number; from: MapViewState } | null>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [stop, setStop] = useState<string | null>(null)
  const [quiet, setQuiet] = useState('')
  const viewKey = `${view.zoom},${view.cx},${view.cy}`

  useLayoutEffect(() => {
    const element = plane.current as HTMLDivElement
    const read = (): void => setSize((now) => (now.w === element.clientWidth && now.h === element.clientHeight ? now : { w: element.clientWidth, h: element.clientHeight }))
    read()
    const observer = new ResizeObserver(read)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => setQuiet(viewKey), window.__KIP__.mapDebounceMs)
    return () => clearTimeout(timer)
  }, [viewKey])

  useEffect(() => setStop(null), [selected])

  const items = useMemo(() => itemsIn(pins, view), [pins, view])
  const coast = useMemo(() => coastline(destination, centre.x, centre.y), [destination, centre.x, centre.y])
  const scale = Math.min(size.w, size.h) / sideOf(view.zoom)
  const tabCode = items.some((item) => item.code === stop) ? stop : items.find((item) => item.members.length === 1 && item.code === selected)?.code ?? items[0]?.code
  const showArea = !sameView(view, searched) && quiet === viewKey
  const step = 100 / 2 ** view.zoom

  const pan = (dx: number, dy: number): void => onView({ ...view, cx: round1(clamp(view.cx + dx)), cy: round1(clamp(view.cy + dy)) })
  const zoomTo = (zoom: number, cx = view.cx, cy = view.cy): void => onView({ zoom: Math.min(MAX_ZOOM, Math.max(0, zoom)), cx: round1(clamp(cx)), cy: round1(clamp(cy)) })

  const onItemKey = (event: KeyboardEvent, item: Item): void => {
    if (event.key.startsWith('Arrow')) {
      event.preventDefault()
      const next = neighbour(items, item, event.key)
      if (next) nodes.current.get(next.code)?.focus()
    } else if (event.key === 'Enter' && item.members.length === 1) {
      event.preventDefault()
      onOpen(item.code)
    }
  }

  const onDown = (event: PointerEvent): void => {
    if ((event.target as HTMLElement).closest('button')) return
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = { x: event.clientX, y: event.clientY, from: view }
  }
  const onMove = (event: PointerEvent): void => {
    const start = drag.current
    if (!start || !scale) return
    onView({ ...start.from, cx: round1(clamp(start.from.cx - (event.clientX - start.x) / scale)), cy: round1(clamp(start.from.cy - (event.clientY - start.y) / scale)) })
  }

  const place = (item: Item): { left: number; top: number } => ({ left: size.w / 2 + (item.x - view.cx) * scale, top: size.h / 2 + (item.y - view.cy) * scale })
  /* Labels that would sit on top of each other are drawn one row lower; their data positions are unchanged. */
  const spread = (): Map<string, { left: number; top: number }> => {
    const placed: { code: string; left: number; top: number }[] = []
    for (const item of [...items].sort((x, y) => x.y - y.y || x.x - y.x)) {
      const spot = place(item)
      while (placed.some((other) => Math.abs(other.left - spot.left) < LABEL_WIDTH && Math.abs(other.top - spot.top) < LABEL_HEIGHT)) spot.top += LABEL_HEIGHT + 2
      placed.push({ code: item.code, ...spot })
    }
    return new Map(placed.map(({ code, left, top }) => [code, { left, top }]))
  }
  const spots = spread()
  const bind = (item: Item) => ({
    ref: (element: HTMLButtonElement | null) => void (element ? nodes.current.set(item.code, element) : nodes.current.delete(item.code)),
    tabIndex: item.code === tabCode ? 0 : -1,
    style: spots.get(item.code) ?? place(item),
    onFocus: () => setStop(item.code),
    onKeyDown: (event: KeyboardEvent) => onItemKey(event, item),
  })

  return (
    <section
      aria-label={app.t('ui.map')} className="map" data-zoom={view.zoom} data-cx={view.cx.toFixed(1)} data-cy={view.cy.toFixed(1)}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return
        event.preventDefault()
        zoomIn.current?.focus()
      }}
    >
      <div ref={plane} className="map-plane" dir="ltr" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={() => void (drag.current = null)} onPointerCancel={() => void (drag.current = null)}>
        <svg className="map-drawing" width={size.w} height={size.h} viewBox={`0 0 ${size.w} ${size.h}`} aria-hidden="true" focusable="false">
          <g transform={`translate(${size.w / 2 - view.cx * scale} ${size.h / 2 - view.cy * scale}) scale(${scale})`}>
            <path d={coast} fill="#f2f2f2" />
          </g>
        </svg>
        {size.w > 0 && items.map((item) => {
          const pin = item.members[0]
          if (item.members.length > 1) {
            return (
              <button
                {...bind(item)} key={item.code} type="button" className="cluster" data-focus-key={`cluster-${item.code}`}
                aria-label={app.t('ui.cluster', { 'count:property': item.members.length })}
                onClick={() => zoomTo(view.zoom + 1, item.x, item.y)}
              >
                {countedPhrase(app.lang, 'property', item.members.length)}
              </button>
            )
          }
          return (
            <button
              {...bind(item)} key={item.code} type="button" className="pin" data-focus-key={`pin-${item.code}`} aria-pressed={selected === item.code}
              aria-label={app.t('ui.pin', { name: pin.name, score: app.fmt.num1(pin.score, app.lang), amount: app.money(pin.display_minor) })}
              onClick={() => onSelect(item.code)}
            >
              <Money minor={pin.display_minor} />
            </button>
          )
        })}
        {showArea && <button type="button" className="btn map-area" data-focus-key="search-area" onClick={onSearchArea}>{app.t('ui.searchThisArea')}</button>}
      </div>
      <div className="map-controls">
        <button type="button" className="map-button" data-focus-key="pan-north" onClick={() => pan(0, -step)}>{app.t('ui.panNorth')}</button>
        <button type="button" className="map-button" data-focus-key="pan-south" onClick={() => pan(0, step)}>{app.t('ui.panSouth')}</button>
        <button type="button" className="map-button" data-focus-key="pan-east" onClick={() => pan(step, 0)}>{app.t('ui.panEast')}</button>
        <button type="button" className="map-button" data-focus-key="pan-west" onClick={() => pan(-step, 0)}>{app.t('ui.panWest')}</button>
        <button ref={zoomIn} type="button" className="map-button" data-focus-key="zoom-in" onClick={() => zoomTo(view.zoom + 1)}>{app.t('ui.zoomIn')}</button>
        <button type="button" className="map-button" data-focus-key="zoom-out" onClick={() => zoomTo(view.zoom - 1)}>{app.t('ui.zoomOut')}</button>
      </div>
    </section>
  )
}
