import type { Direction, LayoutContent, LayoutModule, Piece, SessionTrain } from '../../../shared/domain'
import { blockLengths, buildBlockPaths, positionAlong, type BlockPath, type PathPosition } from '../../../shared/blockpaths'
import { samplePiece, type PathPoint } from '../../../shared/geometry'
import type { SceneTrain } from './contract'

// Everything the stages need to know about the geometry of a layout, derived once per content change.

export interface PieceTrack {
  piece: Piece
  module: LayoutModule
  points: PathPoint[]
  diverging: PathPoint[] | null
}

export interface Bounds { minX: number; maxX: number; minY: number; maxY: number }

export interface LayoutView {
  content: LayoutContent
  paths: Map<string, BlockPath>
  pathsByNumber: Map<number, BlockPath>
  nominalLengths: Map<string, number>
  pieces: PieceTrack[]
  bounds: Bounds
  center: { x_mm: number; y_mm: number }
  signature: string
}

function divergingEnd(module: LayoutModule, piece: Piece): PathPoint | null {
  const sameAsEnd = (p: { x_mm: number; y_mm: number }): boolean => p.x_mm === piece.end.x_mm && p.y_mm === piece.end.y_mm
  const followers = module.pieces.filter(p => p.after_piece_id === piece.id).map(p => p.start)
  const open = module.open_ends.filter(end => end.piece_id === piece.id)
  return [...followers, ...open].find(p => !sameAsEnd(p)) ?? null
}

export function layoutSignature(content: LayoutContent): string {
  const modules = content.modules.map(m => `${m.id}:${m.pieces.map(p => `${p.id}.${p.block_id ?? ''}.${p.start.elevation_mm}.${p.end.elevation_mm}`).join(',')}|${m.open_ends.map(e => e.id).join(',')}`)
  const blocks = content.blocks.map(b => `${b.id}.${b.number}.${b.neighbour_ids.join('+')}`)
  return `${modules.join(';')}#${blocks.join(',')}`
}

export function buildLayoutView(content: LayoutContent): LayoutView {
  const paths = buildBlockPaths(content)
  const pathsByNumber = new Map([...paths.values()].map(path => [path.number, path]))
  const nominalLengths = blockLengths(content)
  const pieces: PieceTrack[] = []
  for (const module of content.modules) {
    for (const piece of module.pieces) {
      const diverging = piece.kind === 'turnout' ? divergingEnd(module, piece) : null
      pieces.push({ piece, module, points: samplePiece(piece, 6), diverging: diverging === null ? null : [piece.start, diverging] })
    }
  }
  const xs: number[] = []
  const ys: number[] = []
  const take = (p: { x_mm: number; y_mm: number }): void => {
    xs.push(p.x_mm)
    ys.push(p.y_mm)
  }
  for (const track of pieces) {
    track.points.forEach(take)
    track.diverging?.forEach(take)
  }
  for (const module of content.modules) {
    take(module.origin)
    module.open_ends.forEach(take)
  }
  const bounds: Bounds = xs.length === 0
    ? { minX: -1000, maxX: 1000, minY: -1000, maxY: 1000 }
    : { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) }
  return {
    content,
    paths,
    pathsByNumber,
    nominalLengths,
    pieces,
    bounds,
    center: { x_mm: (bounds.minX + bounds.maxX) / 2, y_mm: (bounds.minY + bounds.maxY) / 2 },
    signature: layoutSignature(content),
  }
}

// head_offset_mm is measured from the entry end of the block in the train's direction of travel. Paths are
// oriented for east travel, so a west-bound train's entry end is the path's exit end.
function travelPosition(view: LayoutView, blockId: string, direction: Direction, offsetMm: number): PathPosition | null {
  const path = view.paths.get(blockId)
  if (path === undefined) return null
  const nominal = view.nominalLengths.get(blockId) ?? path.length_mm
  const fraction = nominal === 0 ? 0 : Math.min(Math.max(offsetMm / nominal, 0), 1)
  const along = (direction === 'east' ? fraction : 1 - fraction) * path.length_mm
  const position = positionAlong(path, along)
  return direction === 'east' ? position : { ...position, heading_deg: position.heading_deg + 180 }
}

// Position `backMm` behind the head, walking back through the trail blocks.
export function trailPosition(view: LayoutView, train: SceneTrain | SessionTrain, backMm: number): PathPosition | null {
  let back = backMm
  const [headId, ...behind] = train.trail_block_ids.length > 0 ? train.trail_block_ids : [train.head_block_id]
  if (back <= train.head_offset_mm) return travelPosition(view, headId, train.direction, train.head_offset_mm - back)
  back -= train.head_offset_mm
  let last = headId
  for (const id of behind) {
    const length = view.nominalLengths.get(id) ?? view.paths.get(id)?.length_mm ?? 0
    last = id
    if (back <= length) return travelPosition(view, id, train.direction, length - back)
    back -= length
  }
  return travelPosition(view, last, train.direction, 0)
}

// Direction of travel inside each ribbon block, inferred from the order of block numbers.
export function ribbonDirections(blocks: number[], fallback: Direction): Direction[] {
  const directions: Direction[] = []
  blocks.forEach((block, i) => {
    if (i < blocks.length - 1) directions.push(blocks[i + 1] > block ? 'east' : 'west')
    else directions.push(i > 0 ? directions[i - 1] : fallback)
  })
  return directions
}

// A lone ribbon block has no neighbour to read the direction from: use the train standing next to it.
export function fallbackDirection(view: LayoutView, blockNumber: number, trains: SceneTrain[]): Direction {
  const block = view.content.blocks.find(b => b.number === blockNumber)
  const neighbour = trains.find(train => block?.neighbour_ids.includes(train.head_block_id))
  return neighbour?.direction ?? 'east'
}
