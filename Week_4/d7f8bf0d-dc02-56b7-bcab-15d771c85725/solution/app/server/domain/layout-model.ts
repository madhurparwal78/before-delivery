import type { Endplate, LayoutContent, LayoutModule, ModuleOrigin, OpenEnd, Piece, PieceBody, Point } from '../../shared/domain'
import { pieceEnds } from '../../shared/geometry'

// Pure operations on one module: append, remove and edit a piece. Identifiers come from the caller so seeds
// stay deterministic.

export type NewId = (prefix: 'pc' | 'oe') => string

function pointOf(end: Point): Point {
  return { x_mm: end.x_mm, y_mm: end.y_mm, elevation_mm: end.elevation_mm, heading_deg: end.heading_deg }
}

function endLabel(module: LayoutModule, pieceId: string | null, branch: 'through' | 'diverging'): string {
  if (pieceId === null) return `${module.name} start`
  const piece = module.pieces.find(p => p.id === pieceId)
  const ordinal = module.pieces.findIndex(p => p.id === pieceId) + 1
  if (piece?.kind === 'turnout') return `${module.name} ${ordinal} ${branch === 'through' ? 'straight' : 'diverging'}`
  return `${module.name} ${ordinal}`
}

export function newModule(id: string, name: string, endplates: Endplate[], origin: ModuleOrigin, newId: NewId): LayoutModule {
  const module: LayoutModule = { id, name, endplates, origin, pieces: [], open_ends: [] }
  module.open_ends.push({
    id: newId('oe'),
    label: endLabel(module, null, 'through'),
    x_mm: origin.x_mm,
    y_mm: origin.y_mm,
    elevation_mm: 0,
    heading_deg: origin.heading_deg,
    piece_id: null,
  })
  return module
}

export function findOpenEnd(module: LayoutModule, openEndId: string): OpenEnd | undefined {
  return module.open_ends.find(end => end.id === openEndId)
}

// The piece that consumed an open end, if any.
export function consumerOf(module: LayoutModule, openEndId: string): Piece | undefined {
  return module.pieces.find(piece => piece.open_end_id === openEndId)
}

export function followersOf(module: LayoutModule, pieceId: string): Piece[] {
  return module.pieces.filter(piece => piece.after_piece_id === pieceId)
}

function openEndFrom(module: LayoutModule, id: string, pieceId: string, branch: 'through' | 'diverging', at: Point): OpenEnd {
  return { id, label: endLabel(module, pieceId, branch), ...pointOf(at), piece_id: pieceId }
}

export function appendPiece(module: LayoutModule, openEndId: string, body: PieceBody, addedBy: string | null, newId: NewId): Piece {
  const consumed = module.open_ends.find(end => end.id === openEndId)
  if (consumed === undefined) throw new Error(`open end ${openEndId} is not open`)
  const parent = module.pieces.find(piece => piece.id === consumed.piece_id)
  const start = pointOf(consumed)
  const ends = pieceEnds(start, body)
  const piece = {
    ...body,
    id: newId('pc'),
    length_mm: ends.length_mm,
    block_id: parent?.block_id ?? null,
    note: '',
    start,
    end: ends.end,
    open_end_id: consumed.id,
    open_end_label: consumed.label,
    after_piece_id: consumed.piece_id,
    added_by: addedBy,
  } as Piece
  module.pieces.push(piece)
  module.open_ends = module.open_ends.filter(end => end.id !== consumed.id)
  module.open_ends.push(openEndFrom(module, newId('oe'), piece.id, 'through', ends.end))
  if (ends.diverging_end !== null) module.open_ends.push(openEndFrom(module, newId('oe'), piece.id, 'diverging', ends.diverging_end))
  return piece
}

export function removePiece(module: LayoutModule, pieceId: string): void {
  const piece = module.pieces.find(p => p.id === pieceId)
  if (piece === undefined) throw new Error(`piece ${pieceId} is not in ${module.id}`)
  module.pieces = module.pieces.filter(p => p.id !== pieceId)
  module.open_ends = module.open_ends.filter(end => end.piece_id !== pieceId)
  module.open_ends.push({
    id: piece.open_end_id,
    label: piece.open_end_label,
    ...pointOf(piece.start),
    piece_id: piece.after_piece_id,
  })
}

function descendantIds(module: LayoutModule, pieceId: string): Set<string> {
  const found = new Set<string>([pieceId])
  for (const piece of module.pieces) {
    if (piece.after_piece_id !== null && found.has(piece.after_piece_id)) found.add(piece.id)
  }
  return found
}

// A new rise lifts everything built after the piece by the difference.
export function changeRise(module: LayoutModule, pieceId: string, riseMm: number): void {
  const piece = module.pieces.find(p => p.id === pieceId)
  if (piece === undefined) throw new Error(`piece ${pieceId} is not in ${module.id}`)
  const delta = riseMm - piece.rise_mm
  const family = descendantIds(module, pieceId)
  piece.rise_mm = riseMm
  for (const member of module.pieces) {
    if (!family.has(member.id)) continue
    if (member.id !== pieceId) member.start.elevation_mm += delta
    member.end.elevation_mm += delta
  }
  for (const end of module.open_ends) {
    if (end.piece_id !== null && family.has(end.piece_id)) end.elevation_mm += delta
  }
}

const byId = <T extends { id: string }>(a: T, b: T): number => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

// Every array in the content except `pieces` is sorted by id.
export function normalizeContent(content: LayoutContent): LayoutContent {
  return {
    modules: content.modules.map(module => ({
      ...module,
      endplates: [...module.endplates].sort((a, b) => (a.end < b.end ? -1 : 1)),
      open_ends: [...module.open_ends].sort(byId),
    })).sort(byId),
    blocks: [...content.blocks].sort(byId),
    stations: [...content.stations].sort(byId),
    turnouts: [...content.turnouts].sort(byId),
    trains: [...content.trains].sort(byId),
    timetable: { version: content.timetable.version, entries: [...content.timetable.entries].sort(byId) },
  }
}
