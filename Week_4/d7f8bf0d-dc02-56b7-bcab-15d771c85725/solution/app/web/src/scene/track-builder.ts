import {
  BoxGeometry, BufferGeometry, Color, DoubleSide, Group, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, MeshLambertMaterial,
  Object3D, PlaneGeometry, TorusGeometry, type Material,
} from 'three'
import type { PathPoint } from '../../../shared/geometry'
import {
  BED_HALF_WIDTH, COLORS, GAUGE_HALF, RAIL_LIFT, SLAB_HALF_WIDTH, SLAB_THICKNESS, STRIP_HALF_WIDTH, STRIP_PERIOD, TABLE_Y, worldX, worldY, worldZ,
} from './constants'
import { MeshData, offsetEdges, type Pt } from './mesh-data'
import type { LayoutView, PieceTrack } from './layout-view'
import { boardTexture } from './textures'

export function toPoint(p: PathPoint, lift = 0): Pt {
  return { x: worldX(p.x_mm), y: worldY(p.elevation_mm) + lift, z: worldZ(p.y_mm) }
}

function extended(points: Pt[], margin: number): Pt[] {
  const first = points[0]
  const second = points[1]
  const last = points[points.length - 1]
  const before = points[points.length - 2]
  const unit = (a: Pt, b: Pt): [number, number] => {
    const length = Math.hypot(b.x - a.x, b.z - a.z) || 1
    return [(b.x - a.x) / length, (b.z - a.z) / length]
  }
  const [sx, sz] = unit(second, first)
  const [ex, ez] = unit(before, last)
  return [{ ...first, x: first.x + sx * margin, z: first.z + sz * margin }, ...points, { ...last, x: last.x + ex * margin, z: last.z + ez * margin }]
}

function legs(track: PieceTrack): Pt[][] {
  const through = track.points.map(p => toPoint(p))
  return track.diverging === null ? [through] : [through, track.diverging.map(p => toPoint(p))]
}

interface Placement { x: number; y: number; z: number; yaw: number }

function sleepersAlong(points: Pt[], spacing: number): Placement[] {
  const found: Placement[] = []
  let walked = 0
  let next = spacing / 2
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1]
    const b = points[i]
    const length = Math.hypot(b.x - a.x, b.z - a.z)
    if (length === 0) continue
    const yaw = Math.atan2(-(b.z - a.z), b.x - a.x)
    while (next <= walked + length) {
      const t = (next - walked) / length
      found.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t, yaw })
      next += spacing
    }
    walked += length
  }
  return found
}

function instanced(geometry: BufferGeometry, material: Material, placements: Array<{ matrix: Matrix4 }>): InstancedMesh {
  const mesh = new InstancedMesh(geometry, material, Math.max(placements.length, 1))
  placements.forEach((placement, i) => mesh.setMatrixAt(i, placement.matrix))
  mesh.count = placements.length
  mesh.instanceMatrix.needsUpdate = true
  return mesh
}

const dummy = new Object3D()

function matrixAt(x: number, y: number, z: number, yaw: number, scale: [number, number, number] = [1, 1, 1]): { matrix: Matrix4 } {
  dummy.position.set(x, y, z)
  dummy.rotation.set(0, yaw, 0)
  dummy.scale.set(...scale)
  dummy.updateMatrix()
  return { matrix: dummy.matrix.clone() }
}

// Rails and sleepers of some pieces, merged into two draw calls.
export function buildTrack(tracks: PieceTrack[]): Group {
  const group = new Group()
  const rails = new MeshData()
  const sleepers: Placement[] = []
  for (const track of tracks) {
    for (const line of legs(track)) {
      const { left, right } = offsetEdges(line, GAUGE_HALF)
      rails.addStrip(left.map(p => ({ ...p, y: p.y + RAIL_LIFT })), 0.017, 1)
      rails.addStrip(right.map(p => ({ ...p, y: p.y + RAIL_LIFT })), 0.017, 1)
      sleepers.push(...sleepersAlong(line, 0.2))
    }
  }
  if (!rails.empty) group.add(new Mesh(rails.toGeometry(), new MeshLambertMaterial({ color: COLORS.rail, side: DoubleSide })))
  if (sleepers.length > 0) {
    group.add(instanced(new BoxGeometry(0.05, 0.03, 0.3), new MeshLambertMaterial({ color: COLORS.sleeper }),
      sleepers.map(s => matrixAt(s.x, s.y + 0.03, s.z, s.yaw))))
  }
  return group
}

export interface ModuleFascia { moduleId: string; mesh: Mesh; rest: Material }

// Where a module stops: the start of its first piece and each open end. Neighbouring modules share the point.
function endplatePlacements(view: LayoutView): Array<{ matrix: Matrix4 }> {
  const seen = new Set<string>()
  const placements: Array<{ matrix: Matrix4 }> = []
  const height = SLAB_THICKNESS + 0.04
  for (const module of view.content.modules) {
    const ends = module.pieces.length > 0 ? [module.pieces[0].start, ...module.open_ends] : module.open_ends
    for (const end of ends) {
      const key = `${end.x_mm},${end.y_mm}`
      if (seen.has(key)) continue
      seen.add(key)
      const p = toPoint(end)
      placements.push(matrixAt(p.x, p.y + 0.012 - height / 2, p.z, (end.heading_deg * Math.PI) / 180))
    }
  }
  return placements
}

// Tabletop slabs along every piece, with a green track bed, a fascia that alternates from module to module, an endplate
// at each module boundary, and A-frame trestles under them.
export function buildModules(view: LayoutView, fasciaTones: [Material, Material]): { group: Group; fascias: ModuleFascia[] } {
  const group = new Group()
  const top = new MeshData()
  const bed = new MeshData()
  const shade = new MeshData()
  const fascias: ModuleFascia[] = []
  const legPlacements: Array<{ x: number; y: number; z: number; yaw: number; height: number }> = []
  view.content.modules.forEach((module, index) => {
    const fascia = new MeshData()
    const lines = view.pieces.filter(track => track.module.id === module.id).flatMap(legs)
    if (lines.length === 0) {
      const o = { x: worldX(module.origin.x_mm), y: TABLE_Y, z: worldZ(module.origin.y_mm) }
      const h = (module.origin.heading_deg * Math.PI) / 180
      lines.push([o, { x: o.x + Math.cos(h) * 1.2, y: o.y, z: o.z - Math.sin(h) * 1.2 }])
    }
    for (const line of lines) {
      const wide = extended(line, 0.05)
      top.addStrip(wide.map(p => ({ ...p, y: p.y - 0.002 })), SLAB_HALF_WIDTH, 1)
      bed.addStrip(wide.map(p => ({ ...p, y: p.y - 0.0005 })), BED_HALF_WIDTH, 1)
      fascia.addSkirt(wide.map(p => ({ ...p, y: p.y - 0.002 })), SLAB_HALF_WIDTH, SLAB_THICKNESS)
      shade.addStrip(wide.map(p => ({ ...p, y: 0.01 })), SLAB_HALF_WIDTH + 0.14, 1)
    }
    const placed: Pt[] = []
    for (const track of view.pieces.filter(t => t.module.id === module.id)) {
      const mid = toPoint(track.points[Math.floor(track.points.length / 2)])
      if (placed.some(p => Math.hypot(p.x - mid.x, p.z - mid.z) < 1.3)) continue
      placed.push(mid)
      const a = track.points[0]
      const b = track.points[track.points.length - 1]
      legPlacements.push({ ...mid, yaw: Math.atan2(worldZ(a.y_mm) - worldZ(b.y_mm), worldX(b.x_mm) - worldX(a.x_mm)), height: mid.y - SLAB_THICKNESS })
    }
    const rest = fasciaTones[index % 2]
    const mesh = new Mesh(fascia.toGeometry(), rest)
    group.add(mesh)
    fascias.push({ moduleId: module.id, mesh, rest })
  })
  if (!top.empty) group.add(new Mesh(top.toGeometry(), new MeshLambertMaterial({ color: COLORS.surface, side: DoubleSide })))
  if (!bed.empty) group.add(new Mesh(bed.toGeometry(), new MeshBasicMaterial({ color: COLORS.field, side: DoubleSide })))
  if (!shade.empty) group.add(new Mesh(shade.toGeometry(), new MeshBasicMaterial({ color: COLORS.floorShade, side: DoubleSide })))
  const material = new MeshLambertMaterial({ color: COLORS.trestle })
  const posts: Array<{ matrix: Matrix4 }> = []
  const beams: Array<{ matrix: Matrix4 }> = []
  for (const leg of legPlacements) {
    for (const side of [-1, 1]) {
      const dx = Math.sin(leg.yaw) * 0.4 * side
      const dz = Math.cos(leg.yaw) * 0.4 * side
      posts.push(matrixAt(leg.x + dx, leg.height / 2, leg.z + dz, leg.yaw, [1, leg.height, 1]))
    }
    beams.push(matrixAt(leg.x, leg.height * 0.35, leg.z, leg.yaw, [1, 1, 0.8]))
    beams.push(matrixAt(leg.x, leg.height - 0.03, leg.z, leg.yaw, [1, 1, 0.9]))
  }
  if (posts.length > 0) group.add(instanced(new BoxGeometry(0.09, 1, 0.09), material, posts))
  if (beams.length > 0) group.add(instanced(new BoxGeometry(0.07, 0.07, 1), material, beams))
  const endplates = endplatePlacements(view)
  if (endplates.length > 0) {
    group.add(instanced(new BoxGeometry(0.05, SLAB_THICKNESS + 0.04, SLAB_HALF_WIDTH * 2 + 0.06), new MeshLambertMaterial({ color: COLORS.sleeper }), endplates))
  }
  return { group, fascias }
}

// One strip per block along its oriented path. The material (state cue) is set by the stage.
export function buildStrips(view: LayoutView, material: Material): Map<number, Mesh> {
  const strips = new Map<number, Mesh>()
  for (const path of view.paths.values()) {
    if (path.points.length < 2) continue
    const data = new MeshData()
    data.addStrip(path.points.map(p => toPoint(p, 0.003 + path.number * 0.0004)), STRIP_HALF_WIDTH, STRIP_PERIOD)
    const mesh = new Mesh(data.toGeometry(), material)
    mesh.userData = { kind: 'block', number: path.number }
    strips.set(path.number, mesh)
  }
  return strips
}

export function blockMidPoint(view: LayoutView, number: number): Pt | null {
  const path = view.pathsByNumber.get(number)
  if (path === undefined || path.points.length === 0) return null
  const target = path.length_mm / 2
  let i = 1
  while (i < path.points.length - 1 && path.cumulative_mm[i] < target) i += 1
  const a = path.points[i - 1]
  const b = path.points[i]
  const span = path.cumulative_mm[i] - path.cumulative_mm[i - 1]
  const t = span === 0 ? 0 : (target - path.cumulative_mm[i - 1]) / span
  return toPoint({ x_mm: a.x_mm + (b.x_mm - a.x_mm) * t, y_mm: a.y_mm + (b.y_mm - a.y_mm) * t, elevation_mm: a.elevation_mm + (b.elevation_mm - a.elevation_mm) * t }, 0.03)
}

const SIGNAL_OFFSET = 0.52

export interface Signals { mesh: InstancedMesh; blockNumbers: number[]; group: Group }

// A post at the exit end of every block; the lamp colour follows the block state, nothing else moves. Two blocks that
// end at one turnout take opposite sides of the track.
export function buildSignals(view: LayoutView): Signals {
  const group = new Group()
  const numbers: number[] = []
  const posts: Array<{ matrix: Matrix4 }> = []
  const lamps: Array<{ matrix: Matrix4 }> = []
  const collars: Array<{ matrix: Matrix4 }> = []
  const placed: Array<{ x: number; z: number }> = []
  for (const path of view.paths.values()) {
    const n = path.points.length
    if (n < 2) continue
    const exit = toPoint(path.points[n - 1])
    const before = toPoint(path.points[n - 2])
    const length = Math.hypot(exit.x - before.x, exit.z - before.z) || 1
    const beside = (side: number): { x: number; z: number } => ({
      x: exit.x + ((exit.z - before.z) / length) * SIGNAL_OFFSET * side,
      z: exit.z - ((exit.x - before.x) / length) * SIGNAL_OFFSET * side,
    })
    const taken = (spot: { x: number; z: number }): boolean => placed.some(p => Math.hypot(p.x - spot.x, p.z - spot.z) < SIGNAL_OFFSET)
    const { x, z } = taken(beside(1)) ? beside(-1) : beside(1)
    placed.push({ x, z })
    posts.push(matrixAt(x, exit.y + 0.24, z, 0))
    lamps.push(matrixAt(x, exit.y + 0.56, z, 0))
    collars.push(matrixAt(x, exit.y + 0.46, z, 0), matrixAt(x, exit.y + 0.66, z, 0))
    numbers.push(path.number)
  }
  if (posts.length > 0) {
    const ink = new MeshLambertMaterial({ color: COLORS.ink })
    group.add(instanced(new BoxGeometry(0.05, 0.48, 0.05), ink, posts), instanced(new BoxGeometry(0.22, 0.05, 0.22), ink, collars))
  }
  const mesh = instanced(new BoxGeometry(0.15, 0.15, 0.15), new MeshBasicMaterial({ color: '#FFFFFF' }), lamps)
  mesh.setColorAt(0, new Color('#FFFFFF'))
  group.add(mesh)
  return { mesh, blockNumbers: numbers, group }
}

export interface Board { material: MeshBasicMaterial; name: string }

// A low running-in board on the rear edge of the station, readable from both sides, kept short so it never stands in
// front of the track behind it.
export function buildBoards(view: LayoutView, names: Record<string, string>): { group: Group; boards: Map<string, Board> } {
  const group = new Group()
  const boards = new Map<string, Board>()
  for (const station of view.content.stations) {
    const mids = station.block_ids
      .map(id => view.paths.get(id)?.number)
      .map(number => (number === undefined ? null : blockMidPoint(view, number)))
      .filter((p): p is Pt => p !== null)
    if (mids.length === 0) continue
    const x = mids.reduce((sum, p) => sum + p.x, 0) / mids.length
    const z = Math.min(...mids.map(p => p.z)) - SLAB_HALF_WIDTH - 0.08
    const y = mids[0].y
    const name = names[station.id] ?? station.name
    const material = new MeshBasicMaterial({ map: boardTexture(name), side: DoubleSide })
    const post = new Mesh(new BoxGeometry(0.08, y + 0.06, 0.08), new MeshLambertMaterial({ color: COLORS.trestle }))
    post.position.set(x, (y + 0.06) / 2, z - 0.02)
    const front = new Mesh(new PlaneGeometry(1.8, 0.45), material)
    front.position.set(x, y + 0.22, z)
    const back = new Mesh(new PlaneGeometry(1.8, 0.45), material)
    back.position.set(x, y + 0.22, z - 0.04)
    back.rotation.y = Math.PI
    group.add(post, front, back)
    boards.set(station.id, { material, name })
  }
  return { group, boards }
}

export interface OpenEndMarkers { mesh: InstancedMesh | null; ids: string[]; labels: string[]; points: Pt[] }

export function buildOpenEndMarkers(view: LayoutView): OpenEndMarkers {
  const ends = view.content.modules.flatMap(module => module.open_ends)
  if (ends.length === 0) return { mesh: null, ids: [], labels: [], points: [] }
  const geometry = new TorusGeometry(0.17, 0.05, 6, 16)
  geometry.rotateX(-Math.PI / 2)
  const points = ends.map(end => toPoint(end, RAIL_LIFT))
  const mesh = instanced(geometry, new MeshBasicMaterial({ color: COLORS.action }), points.map(p => matrixAt(p.x, p.y, p.z, 0)))
  mesh.userData = { kind: 'open_end' }
  return { mesh, ids: ends.map(end => end.id), labels: ends.map(end => end.label), points }
}

export function buildPickMeshes(view: LayoutView): Group {
  const group = new Group()
  for (const track of view.pieces) {
    const data = new MeshData()
    data.addStrip(track.points.map(p => toPoint(p, 0.02)), 0.25, 1)
    const mesh = new Mesh(data.toGeometry(), new MeshBasicMaterial({ side: DoubleSide }))
    mesh.visible = false
    mesh.userData = { kind: 'piece', id: track.piece.id }
    group.add(mesh)
  }
  return group
}
