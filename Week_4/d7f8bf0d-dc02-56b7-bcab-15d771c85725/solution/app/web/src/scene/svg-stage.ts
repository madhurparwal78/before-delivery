import type { BlockState } from '../../../shared/domain'
import { samplePiece } from '../../../shared/geometry'
import type { StageCallbacks, StageController, StageInputs, StagePick, StageReport } from './contract'
import { COLORS, SLAB_HALF_WIDTH, STRIP_HALF_WIDTH } from './constants'
import { attachGestures } from './gestures'
import { buildLayoutView, layoutSignature, trailPosition, type LayoutView } from './layout-view'
import { ViewState } from './view-state'

const NS = 'http://www.w3.org/2000/svg'
// This stage is ready after two stages: the frame and the first drawing.
const BUILD_STAGES = 2
const TRAIN_COLOURS = [COLORS.accentDeep, COLORS.pink, COLORS.violet, '#12A7A0']

function el(tag: string, attrs: Record<string, string | number>, parent?: Element): SVGElement {
  const node = document.createElementNS(NS, tag)
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, String(value))
  parent?.appendChild(node)
  return node as SVGElement
}

const points = (list: Array<{ x_mm: number; y_mm: number }>): string => list.map(p => `${Math.round(p.x_mm)},${Math.round(p.y_mm)}`).join(' ')

function patterns(defs: Element): void {
  const make = (id: string, size: number, background: string, draw: (p: SVGElement) => void): void => {
    const pattern = el('pattern', { id, width: size, height: size, patternUnits: 'userSpaceOnUse' }, defs)
    el('rect', { width: size, height: size, fill: background }, pattern)
    draw(pattern)
  }
  make('p-reserved', 500, COLORS.accent, p => el('polyline', { points: '90,330 250,150 410,330', fill: 'none', stroke: '#FFFFFF', 'stroke-width': 60, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, p))
  make('p-occupied', 500, COLORS.action, p => {
    el('rect', { x: 120, y: 200, width: 260, height: 100, fill: COLORS.ink }, p)
    el('rect', { x: 120, y: 150, width: 90, height: 60, fill: COLORS.ink }, p)
    for (const x of [160, 250, 340]) el('circle', { cx: x, cy: 320, r: 34, fill: COLORS.ink }, p)
  })
  const hatch = (id: string, background: string, line: string): void => make(id, 200, background, p => {
    for (const offset of [-200, 0, 200]) el('line', { x1: offset, y1: 200, x2: offset + 200, y2: 0, stroke: line, 'stroke-width': 44 }, p)
  })
  hatch('p-out', COLORS.ink, '#9AA3BD')
  hatch('p-conflict', COLORS.action, COLORS.ink)
}

class SvgStage implements StageController {
  private readonly svg: SVGSVGElement
  private readonly world: SVGGElement
  private readonly view = new ViewState()
  private readonly detach: () => void
  private readonly resizeObserver: ResizeObserver
  private inputs: StageInputs | null = null
  private layout: LayoutView | null = null
  private width = 1
  private height = 1
  private scheduled = 0
  private lastReport = ''
  private firstShown = false

  constructor(private readonly host: HTMLElement, private readonly callbacks: StageCallbacks) {
    this.svg = el('svg', { width: '100%', height: '100%', role: 'presentation' }) as SVGSVGElement
    this.svg.style.cssText = 'position:absolute;inset:0;display:block;touch-action:none;background:#3FB56B'
    patterns(el('defs', {}, this.svg))
    this.world = el('g', {}, this.svg) as SVGGElement
    host.appendChild(this.svg)
    this.detach = attachGestures(this.svg, {
      pan: (dx, dy) => { this.view.panScreen(dx, dy, 1 / this.scale(), 1 / this.scale()); this.request() },
      zoom: factor => { this.view.zoomBy(factor); this.request() },
      rotate: delta => { this.view.rotateBy(delta); this.request() },
      tap: event => this.pick(event),
    })
    this.resizeObserver = new ResizeObserver(() => { this.measure(); this.request() })
    this.resizeObserver.observe(host)
    this.measure()
    callbacks.onProgress(1 / BUILD_STAGES)
  }

  private measure(): void {
    this.width = Math.max(this.host.clientWidth, 1)
    this.height = Math.max(this.host.clientHeight, 1)
  }

  private insetRight = 0

  private scale(): number {
    const b = this.layout?.bounds ?? { minX: -1000, maxX: 1000, minY: -1000, maxY: 1000 }
    const fit = Math.min(((this.width - this.insetRight) * 0.9) / Math.max(b.maxX - b.minX, 1), (this.height * 0.7) / Math.max(b.maxY - b.minY, 2500))
    return fit * this.view.zoom
  }

  update(inputs: StageInputs): void {
    this.inputs = inputs
    this.insetRight = inputs.inset_right_px
    this.view.reduced = inputs.reduced_motion
    if (this.layout === null || this.layout.signature !== layoutSignature(inputs.content)) this.layout = buildLayoutView(inputs.content)
    this.draw(this.layout, inputs)
    this.request()
  }

  turnHeading(deltaDeg: number): void { this.view.turnHeading(deltaDeg); this.request() }
  setHeading(deg: number): void { this.view.setHeading(deg); this.request() }
  panBy(dxPx: number, dyPx: number): void { this.view.panScreen(dxPx, dyPx, 1 / this.scale(), 1 / this.scale()); this.request() }
  zoomBy(factor: number): void { this.view.zoomBy(factor); this.request() }
  resetView(): void { this.view.reset(); this.request() }

  dispose(): void {
    cancelAnimationFrame(this.scheduled)
    this.detach()
    this.resizeObserver.disconnect()
    this.svg.remove()
  }

  private request(): void {
    if (this.scheduled !== 0) return
    this.scheduled = requestAnimationFrame(now => {
      this.scheduled = 0
      this.view.step(now)
      this.place()
      if (this.view.animating) this.request()
    })
  }

  // Maps world millimetres (y up) to screen pixels for the current heading, zoom and pan.
  private matrix(): [number, number, number, number, number, number] {
    const k = this.scale()
    const h = (this.view.heading * Math.PI) / 180
    const centre = this.layout?.center ?? { x_mm: 0, y_mm: 0 }
    const tx = centre.x_mm + this.view.panX
    const ty = centre.y_mm + this.view.panY
    const c = Math.cos(h)
    const s = Math.sin(h)
    return [k * c, -k * s, -k * s, -k * c, (this.width - this.insetRight) / 2 - k * (c * tx - s * ty), this.height / 2 + k * (s * tx + c * ty)]
  }

  private place(): void {
    const m = this.matrix()
    this.world.setAttribute('transform', `matrix(${m.join(' ')})`)
    const rect = this.host.getBoundingClientRect()
    const block_points: Record<number, [number, number]> = {}
    for (const path of this.layout?.pathsByNumber.values() ?? []) {
      const mid = path.points[Math.floor(path.points.length / 2)]
      if (mid === undefined) continue
      block_points[path.number] = [Math.round(rect.left + m[0] * mid.x_mm + m[2] * mid.y_mm + m[4]), Math.round(rect.top + m[1] * mid.x_mm + m[3] * mid.y_mm + m[5])]
    }
    const report: StageReport = {
      heading: this.view.reportedHeading(),
      zoom: Math.round(this.view.zoom * 1000) / 1000,
      pan: [Math.round(this.view.panX * 10) / 10, Math.round(this.view.panY * 10) / 10],
      animating: this.view.animating && !(this.inputs?.reduced_motion ?? false),
      block_points,
    }
    const key = JSON.stringify(report)
    if (key !== this.lastReport) {
      this.lastReport = key
      this.callbacks.onReport(report)
    }
    if (!this.firstShown && this.layout !== null) {
      this.firstShown = true
      this.callbacks.onProgress(2 / BUILD_STAGES)
    }
  }

  private draw(layout: LayoutView, inputs: StageInputs): void {
    this.world.replaceChildren()
    const g = (name: string): SVGElement => el('g', { class: name }, this.world)
    const slab = g('slab')
    const strips = g('strips')
    const track = g('track')
    const marks = g('marks')
    const state = (number: number): BlockState => inputs.block_states[number] ?? 'free'
    const stroke = (parent: Element, pts: string, color: string, width: number, extra: Record<string, string | number> = {}): SVGElement =>
      el('polyline', { points: pts, fill: 'none', stroke: color, 'stroke-width': width, 'stroke-linejoin': 'round', 'stroke-linecap': 'butt', ...extra }, parent)

    for (const t of layout.pieces) {
      for (const line of [t.points, ...(t.diverging === null ? [] : [t.diverging])]) {
        stroke(slab, points(line), COLORS.surface, SLAB_HALF_WIDTH * 2000, { 'stroke-linecap': 'round' })
        stroke(track, points(line), COLORS.rail, 60)
        stroke(track, points(line), COLORS.sleeper, 190, { 'stroke-dasharray': '30 110', opacity: 0.8 })
      }
      el('polyline', { points: points(samplePiece(t.piece)), fill: 'none', stroke: 'transparent', 'stroke-width': 320, 'data-kind': 'piece', 'data-id': t.piece.id }, marks)
    }
    for (const path of layout.paths.values()) {
      if (path.points.length < 2) continue
      const fill = { free: COLORS.field, reserved: 'url(#p-reserved)', occupied: 'url(#p-occupied)', out_of_service: 'url(#p-out)' }[state(path.number)]
      stroke(strips, points(path.points), fill, STRIP_HALF_WIDTH * 2000, { 'data-kind': 'block', 'data-number': path.number })
      if (inputs.conflict_block === path.number) stroke(strips, points(path.points), 'url(#p-conflict)', STRIP_HALF_WIDTH * 2000)
      if (inputs.selection.block_number === path.number) stroke(strips, points(path.points), COLORS.accentDeep, 90, { opacity: 0.9 })
    }
    for (const t of layout.pieces) {
      if (inputs.selection.piece_id === t.piece.id) stroke(marks, points(t.points), COLORS.accentDeep, 120)
    }
    const drawn = new Set(inputs.ribbons.flatMap(r => r.blocks).concat(inputs.preview_blocks))
    for (const number of drawn) {
      const path = layout.pathsByNumber.get(number)
      if (path === undefined) continue
      const preview = !inputs.ribbons.some(r => r.blocks.includes(number))
      stroke(marks, points(path.points), preview ? '#BFE3F7' : COLORS.accent, 300, { opacity: preview ? 0.7 : 1 })
      stroke(marks, points(path.points), '#FFFFFF', 300, { 'stroke-dasharray': '90 410', opacity: 0.9 })
    }
    const flag = inputs.limit_flag_block === null ? undefined : layout.pathsByNumber.get(inputs.limit_flag_block)
    if (flag !== undefined) {
      const tip = flag.points[flag.points.length - 1]
      el('polygon', { points: `${tip.x_mm},${tip.y_mm} ${tip.x_mm},${tip.y_mm + 700} ${tip.x_mm + 500},${tip.y_mm + 560}`, fill: COLORS.accentDeep, stroke: COLORS.ink, 'stroke-width': 30 }, marks)
    }
    for (const station of layout.content.stations) {
      const spots = station.block_ids.flatMap(id => layout.paths.get(id)?.points.slice(0, 1) ?? [])
      if (spots.length === 0) continue
      el('text', { x: spots[0].x_mm, y: spots[0].y_mm + 700, 'font-size': 300, fill: COLORS.ink, 'font-family': 'Fredoka, sans-serif', 'font-weight': 600, transform: `translate(0 ${2 * (spots[0].y_mm + 700)}) scale(1 -1)` }, marks).textContent = inputs.station_names[station.id] ?? station.name
    }
    inputs.trains.forEach((train, i) => {
      const spots = [0, 0.25, 0.5, 0.75, 1].map(f => trailPosition(layout, train, train.length_mm * f)).filter(p => p !== null)
      if (spots.length < 2) return
      const halo = inputs.selection.train_number === train.number
      stroke(marks, points(spots), TRAIN_COLOURS[i % TRAIN_COLOURS.length], 230, { 'stroke-linecap': 'round', 'data-kind': 'train', 'data-number': train.number, ...(halo ? { stroke: COLORS.accent } : {}) })
      stroke(marks, points(spots), TRAIN_COLOURS[i % TRAIN_COLOURS.length], halo ? 150 : 230, { 'stroke-linecap': 'round', 'data-kind': 'train', 'data-number': train.number })
    })
    if (inputs.mode === 'build') {
      for (const module of layout.content.modules) {
        for (const end of module.open_ends) {
          const selected = inputs.selection.open_end_id === end.id
          el('circle', { cx: end.x_mm, cy: end.y_mm, r: selected ? 260 : 170, fill: 'none', stroke: selected ? COLORS.accentDeep : COLORS.action, 'stroke-width': 70, 'data-kind': 'open_end', 'data-id': end.id }, marks)
        }
      }
    }
  }

  private pick(event: PointerEvent): void {
    const parked = this.inputs?.mode === 'build'
    const hit = document.elementsFromPoint(event.clientX, event.clientY).find(node => {
      const found = node.getAttribute('data-kind')
      return found !== null && !(parked && found === 'train')
    })
    if (hit === undefined) return
    const kind = hit.getAttribute('data-kind')
    const id = hit.getAttribute('data-id') ?? ''
    const number = hit.getAttribute('data-number') ?? ''
    const pick: StagePick | null = kind === 'piece' ? { kind: 'piece', id }
      : kind === 'open_end' ? { kind: 'open_end', id }
      : kind === 'train' ? { kind: 'train', number }
      : kind === 'block' && this.inputs?.mode === 'operate' ? { kind: 'block', number: Number(number) } : null
    if (pick !== null) this.callbacks.onPick(pick)
  }
}

export function createSvgStage(host: HTMLElement, callbacks: StageCallbacks): StageController {
  return new SvgStage(host, callbacks)
}
