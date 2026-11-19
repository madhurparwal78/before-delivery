import {
  BoxGeometry, BufferAttribute, BufferGeometry, DoubleSide, Group, Mesh, MeshBasicMaterial, MeshLambertMaterial, Shape, ShapeGeometry,
  type Material,
} from 'three'
import type { Direction } from '../../../shared/domain'
import type { BlockPath } from '../../../shared/blockpaths'
import { COLORS, DURATION, RIBBON_HALF_WIDTH, RIBBON_LIFT, RIBBON_PERIOD } from './constants'
import { Step } from './easing'
import type { SceneRibbon, SceneTrain } from './contract'
import { fallbackDirection, ribbonDirections, type LayoutView } from './layout-view'
import { offsetEdges, type Pt } from './mesh-data'
import { toPoint } from './track-builder'

const TABLE_SAMPLES = 48
const SLICES = 16

interface Sample { x: number; y: number; z: number; nx: number; nz: number }

// The path resampled evenly in the direction of travel, with the lateral normal at every sample.
function travelTable(path: BlockPath, direction: Direction): Sample[] {
  const forward = path.points.map(p => toPoint(p))
  const points = direction === 'east' ? forward : [...forward].reverse()
  const lengths = [0]
  for (let i = 1; i < points.length; i += 1) lengths.push(lengths[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z))
  const total = lengths[lengths.length - 1] || 1
  const even: Pt[] = []
  let k = 1
  for (let i = 0; i <= TABLE_SAMPLES; i += 1) {
    const at = (total * i) / TABLE_SAMPLES
    while (k < points.length - 1 && lengths[k] < at) k += 1
    const a = points[k - 1]
    const b = points[k]
    const span = lengths[k] - lengths[k - 1] || 1
    const t = Math.min(Math.max((at - lengths[k - 1]) / span, 0), 1)
    even.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t })
  }
  const { left } = offsetEdges(even, 1)
  return even.map((p, i) => ({ ...p, nx: left[i].x - p.x, nz: left[i].z - p.z }))
}

function interpolate(table: Sample[], fraction: number): Sample {
  const f = Math.min(Math.max(fraction, 0), 1) * TABLE_SAMPLES
  const i = Math.min(Math.floor(f), TABLE_SAMPLES - 1)
  const t = f - i
  const a = table[i]
  const b = table[i + 1]
  const mix = (u: number, v: number): number => u + (v - u) * t
  return { x: mix(a.x, b.x), y: mix(a.y, b.y), z: mix(a.z, b.z), nx: mix(a.nx, b.nx), nz: mix(a.nz, b.nz) }
}

function ribbonGeometry(): BufferGeometry {
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array((SLICES + 1) * 2 * 3), 3))
  geometry.setAttribute('uv', new BufferAttribute(new Float32Array((SLICES + 1) * 2 * 2), 2))
  const indices: number[] = []
  for (let i = 0; i < SLICES; i += 1) {
    const a = i * 2
    indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
  }
  geometry.setIndex(indices)
  return geometry
}

class RibbonBlock {
  readonly mesh: Mesh
  readonly table: Sample[]
  readonly lengthM: number
  from = 0
  to = 0
  private fromTarget = 0
  private toTarget = 0
  private fromStart = 0
  private toStart = 0
  private step: Step | null = null
  removing = false

  constructor(readonly number: number, readonly direction: Direction, path: BlockPath, material: Material) {
    this.table = travelTable(path, direction)
    this.lengthM = path.length_mm / 1000
    this.mesh = new Mesh(ribbonGeometry(), material)
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = 2
  }

  get animating(): boolean {
    return this.step !== null
  }

  retarget(from: number, to: number, animate: boolean): void {
    this.fromStart = this.from
    this.toStart = this.to
    this.fromTarget = from
    this.toTarget = to
    if (animate) {
      this.step = new Step(DURATION.ribbonBlock)
    } else {
      this.step = null
      this.from = from
      this.to = to
      this.write()
    }
  }

  advance(now: number): void {
    if (this.step === null) return
    const t = this.step.eased(now)
    this.from = this.fromStart + (this.fromTarget - this.fromStart) * t
    this.to = this.toStart + (this.toTarget - this.toStart) * t
    if (this.step.done(now)) this.step = null
    this.write()
  }

  get finishedRemoving(): boolean {
    return this.removing && this.step === null
  }

  private write(): void {
    this.mesh.visible = this.to - this.from > 0.001
    if (!this.mesh.visible) return
    const position = this.mesh.geometry.getAttribute('position')
    const uv = this.mesh.geometry.getAttribute('uv')
    const lift = RIBBON_LIFT + this.number * 0.0004
    for (let i = 0; i <= SLICES; i += 1) {
      const f = this.from + ((this.to - this.from) * i) / SLICES
      const s = interpolate(this.table, f)
      position.setXYZ(i * 2, s.x + s.nx * RIBBON_HALF_WIDTH, s.y + lift, s.z + s.nz * RIBBON_HALF_WIDTH)
      position.setXYZ(i * 2 + 1, s.x - s.nx * RIBBON_HALF_WIDTH, s.y + lift, s.z - s.nz * RIBBON_HALF_WIDTH)
      uv.setXY(i * 2, 0, (f * this.lengthM) / RIBBON_PERIOD)
      uv.setXY(i * 2 + 1, 1, (f * this.lengthM) / RIBBON_PERIOD)
    }
    position.needsUpdate = true
    uv.needsUpdate = true
  }

  dispose(): void {
    this.mesh.geometry.dispose()
  }
}

// Ribbons of reserved blocks. A block entering a list fills over 180 ms in the direction of travel; one leaving
// the tail gives back from its entry side, one leaving the head retracts from its exit side.
export class Ribbons {
  readonly group = new Group()
  private readonly blocks = new Map<string, RibbonBlock>()
  private readonly lists = new Map<string, number[]>()
  private readonly directions = new Map<number, Direction>()

  constructor(private readonly material: Material, private readonly animated: boolean) {}

  directionOf(number: number): Direction | undefined {
    return this.directions.get(number)
  }

  clear(): void {
    for (const block of this.blocks.values()) {
      this.group.remove(block.mesh)
      block.dispose()
    }
    this.blocks.clear()
    this.lists.clear()
  }

  sync(view: LayoutView, ribbons: SceneRibbon[], trains: SceneTrain[], reduced: boolean): void {
    const animate = this.animated && !reduced
    const seen = new Set<string>()
    for (const ribbon of ribbons) {
      const fallback = ribbon.blocks.length > 0 ? fallbackDirection(view, ribbon.blocks[0], trains) : 'east'
      const directions = ribbonDirections(ribbon.blocks, fallback)
      ribbon.blocks.forEach((number, i) => {
        const key = `${ribbon.id}:${number}`
        seen.add(key)
        this.directions.set(number, directions[i])
        let block = this.blocks.get(key)
        const path = view.pathsByNumber.get(number)
        if (path === undefined) return
        if (block === undefined) {
          block = new RibbonBlock(number, directions[i], path, this.material)
          this.blocks.set(key, block)
          this.group.add(block.mesh)
        }
        block.removing = false
        block.retarget(0, 1, animate)
      })
    }
    for (const [key, block] of this.blocks) {
      if (seen.has(key) || block.removing) continue
      const [ribbonId] = key.split(':')
      const previous = this.lists.get(ribbonId) ?? []
      const head = previous[previous.length - 1] === block.number
      block.removing = true
      if (head) block.retarget(block.from, 0, animate)
      else block.retarget(1, block.to, animate)
    }
    this.lists.clear()
    for (const ribbon of ribbons) this.lists.set(ribbon.id, ribbon.blocks)
    for (const [key, block] of this.blocks) {
      if (block.removing && !block.animating) this.drop(key, block)
    }
  }

  private drop(key: string, block: RibbonBlock): void {
    this.group.remove(block.mesh)
    block.dispose()
    this.blocks.delete(key)
  }

  advance(now: number): boolean {
    let moving = false
    for (const [key, block] of this.blocks) {
      block.advance(now)
      if (block.finishedRemoving) this.drop(key, block)
      else moving = moving || block.animating
    }
    return moving
  }
}

// Limit flag at the exit end of the last granted block, rising over 240 ms.
export class LimitFlag {
  readonly group = new Group()
  private block: number | null = null
  private rise: Step | null = null

  constructor() {
    // About a metre tall, so at the fit-all zoom the pennant stays inside its own row and never hides the row behind it.
    const pole = new Mesh(new BoxGeometry(0.06, 1, 0.06), new MeshLambertMaterial({ color: COLORS.ink }))
    pole.position.y = 0.5
    const pennant = (length: number, drop: number): ShapeGeometry =>
      new ShapeGeometry(new Shape().moveTo(0, 0).lineTo(length, -drop / 2).lineTo(0, -drop).closePath())
    const edge = new Mesh(pennant(0.72, 0.48), new MeshBasicMaterial({ color: COLORS.ink, side: DoubleSide }))
    edge.position.set(0.03, 1, 0)
    const cloth = new Mesh(pennant(0.6, 0.38), new MeshBasicMaterial({ color: COLORS.accentDeep, side: DoubleSide }))
    cloth.position.set(0.03, 0.955, 0.004)
    this.group.add(pole, edge, cloth)
    this.group.visible = false
  }

  get animating(): boolean {
    return this.rise !== null
  }

  sync(view: LayoutView, number: number | null, direction: Direction, reduced: boolean): void {
    if (number === this.block) return
    this.block = number
    const path = number === null ? undefined : view.pathsByNumber.get(number)
    if (path === undefined || path.points.length < 2) {
      this.group.visible = false
      this.rise = null
      return
    }
    const points = path.points.map(p => toPoint(p))
    const exit = direction === 'east' ? points[points.length - 1] : points[0]
    const inner = direction === 'east' ? points[points.length - 2] : points[1]
    const length = Math.hypot(exit.x - inner.x, exit.z - inner.z) || 1
    // Beside the track on the side facing the home camera, so the pennant never stands over the row behind it.
    const side = exit.x - inner.x < 0 ? -1 : 1
    this.group.position.set(exit.x - ((exit.z - inner.z) / length) * 0.52 * side, exit.y + 0.04, exit.z + ((exit.x - inner.x) / length) * 0.52 * side)
    this.group.visible = true
    this.rise = reduced ? null : new Step(DURATION.flag)
    this.group.scale.y = reduced ? 1 : 0.001
  }

  advance(now: number): void {
    if (this.rise === null) return
    this.group.scale.y = Math.max(this.rise.eased(now), 0.001)
    if (this.rise.done(now)) this.rise = null
  }
}

export function previewMaterial(map: MeshBasicMaterial['map']): MeshBasicMaterial {
  return new MeshBasicMaterial({ map, side: DoubleSide, transparent: true, opacity: 0.6, depthWrite: false })
}
