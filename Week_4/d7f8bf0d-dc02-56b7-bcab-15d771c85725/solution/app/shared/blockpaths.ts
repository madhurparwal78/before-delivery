import type { LayoutBlock, LayoutContent, Piece } from './domain'
import { samplePiece, type PathPoint } from './geometry'

// Oriented east-travel polyline of every block. A block's pieces are laid in construction order, which can run
// either way along the track, so the entry end is the one nearest the blocks to the west (or farthest from
// the blocks to the east).

export interface BlockPath {
  block_id: string
  number: number
  points: PathPoint[]
  cumulative_mm: number[]
  length_mm: number
}

export interface PathPosition {
  x_mm: number
  y_mm: number
  elevation_mm: number
  heading_deg: number
}

function distance(a: PathPoint, b: PathPoint): number {
  return Math.hypot(a.x_mm - b.x_mm, a.y_mm - b.y_mm)
}

function polyline(pieces: Piece[]): PathPoint[] {
  const points: PathPoint[] = []
  for (const piece of pieces) {
    const sampled = samplePiece(piece)
    points.push(...(points.length === 0 ? sampled : sampled.slice(1)))
  }
  return points
}

function nearest(point: PathPoint, others: PathPoint[]): number {
  return others.length === 0 ? Infinity : Math.min(...others.map(other => distance(point, other)))
}

function ends(points: PathPoint[]): PathPoint[] {
  return [points[0], points[points.length - 1]]
}

function orient(block: LayoutBlock, raw: Map<string, PathPoint[]>, blocks: Map<string, LayoutBlock>): PathPoint[] {
  const points = raw.get(block.id) ?? []
  if (points.length < 2) return points
  const neighbourEnds = (east: boolean): PathPoint[] =>
    block.neighbour_ids.flatMap(id => {
      const other = blocks.get(id)
      return other !== undefined && (other.number > block.number) === east ? ends(raw.get(id) ?? []) : []
    })
  const eastEnds = neighbourEnds(true)
  const westEnds = neighbourEnds(false)
  const [first, last] = ends(points)
  const reverse = eastEnds.length > 0
    ? nearest(first, eastEnds) < nearest(last, eastEnds)
    : westEnds.length > 0 && nearest(last, westEnds) < nearest(first, westEnds)
  return reverse ? [...points].reverse() : points
}

// The length of every block: the sum of its pieces.
export function blockLengths(content: LayoutContent): Map<string, number> {
  const lengths = new Map<string, number>()
  for (const module of content.modules) {
    for (const piece of module.pieces) {
      if (piece.block_id !== null) lengths.set(piece.block_id, (lengths.get(piece.block_id) ?? 0) + piece.length_mm)
    }
  }
  return lengths
}

export function buildBlockPaths(content: LayoutContent): Map<string, BlockPath> {
  const byBlock = new Map<string, Piece[]>()
  for (const module of content.modules) {
    for (const piece of module.pieces) {
      if (piece.block_id === null) continue
      byBlock.set(piece.block_id, [...(byBlock.get(piece.block_id) ?? []), piece])
    }
  }
  const raw = new Map([...byBlock].map(([id, pieces]) => [id, polyline(pieces)]))
  const blocks = new Map(content.blocks.map(block => [block.id, block]))
  const paths = new Map<string, BlockPath>()
  for (const block of content.blocks) {
    const points = orient(block, raw, blocks)
    const cumulative = [0]
    for (let i = 1; i < points.length; i += 1) cumulative.push(cumulative[i - 1] + distance(points[i - 1], points[i]))
    paths.set(block.id, { block_id: block.id, number: block.number, points, cumulative_mm: cumulative, length_mm: cumulative[cumulative.length - 1] ?? 0 })
  }
  return paths
}

// Position at `distanceMm` from the entry end, measured along the path's own length.
export function positionAlong(path: BlockPath, distanceMm: number): PathPosition {
  const { points, cumulative_mm: cumulative } = path
  if (points.length === 0) return { x_mm: 0, y_mm: 0, elevation_mm: 0, heading_deg: 0 }
  if (points.length === 1) return { ...points[0], heading_deg: 0 }
  const at = Math.min(Math.max(distanceMm, 0), path.length_mm)
  let i = 1
  while (i < points.length - 1 && cumulative[i] < at) i += 1
  const a = points[i - 1]
  const b = points[i]
  const span = cumulative[i] - cumulative[i - 1]
  const t = span === 0 ? 0 : (at - cumulative[i - 1]) / span
  return {
    x_mm: a.x_mm + (b.x_mm - a.x_mm) * t,
    y_mm: a.y_mm + (b.y_mm - a.y_mm) * t,
    elevation_mm: a.elevation_mm + (b.elevation_mm - a.elevation_mm) * t,
    heading_deg: (Math.atan2(b.y_mm - a.y_mm, b.x_mm - a.x_mm) * 180) / Math.PI,
  }
}
