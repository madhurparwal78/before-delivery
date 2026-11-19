import type {
  BlockKind, Hand, LayoutBlock, LayoutContent, LayoutModule, LayoutTurnout, PieceBody, Station, TimetableEntry, TrainSpec,
} from '../../shared/domain'
import { appendPiece, newModule, normalizeContent, type NewId } from './layout-model'

// The reference layout: five modules, twelve blocks, four turnouts, three stations, three trains. The pieces are
// shaped so each block's piece lengths add up to its length and every default-profile rule passes. The line folds
// back on itself twice, as a club sets it up in a hall: Wren Quay, a half circle, Fernhill, a half circle, Tarn Head.

const RADIUS = 1067
const FOLD_RADIUS = 1150
const BLOCK_IDS = Array.from({ length: 12 }, (_, i) => `blk-${String(i + 1).padStart(2, '0')}`)
const blockId = (number: number): string => BLOCK_IDS[number - 1]

interface BlockSpec { number: number; name: string; kind: BlockKind; module: string; neighbours: number[] }

const BLOCKS: BlockSpec[] = [
  { number: 1, name: 'Wren Quay Road', kind: 'plain', module: 'mod-wren', neighbours: [3] },
  { number: 2, name: 'Wren Quay Loop', kind: 'loop', module: 'mod-wren', neighbours: [3] },
  { number: 3, name: 'Wren Approach', kind: 'approach', module: 'mod-wren', neighbours: [1, 2, 4] },
  { number: 4, name: 'Single Line West', kind: 'plain', module: 'mod-west', neighbours: [3, 5] },
  { number: 5, name: 'Fernhill West Approach', kind: 'approach', module: 'mod-fernhill', neighbours: [4, 6, 7] },
  { number: 6, name: 'Fernhill Main', kind: 'plain', module: 'mod-fernhill', neighbours: [5, 8] },
  { number: 7, name: 'Fernhill Loop', kind: 'loop', module: 'mod-fernhill', neighbours: [5, 8] },
  { number: 8, name: 'Fernhill East Approach', kind: 'approach', module: 'mod-fernhill', neighbours: [6, 7, 9] },
  { number: 9, name: 'Single Line East', kind: 'plain', module: 'mod-east', neighbours: [8, 10] },
  { number: 10, name: 'Tarn Approach', kind: 'approach', module: 'mod-tarn', neighbours: [9, 11, 12] },
  { number: 11, name: 'Tarn Head Road', kind: 'plain', module: 'mod-tarn', neighbours: [10] },
  { number: 12, name: 'Tarn Head Loop', kind: 'loop', module: 'mod-tarn', neighbours: [10] },
]

const MODULE_NAMES: Array<[string, string]> = [
  ['mod-east', 'Single Line East'], ['mod-fernhill', 'Fernhill'], ['mod-tarn', 'Tarn Head'], ['mod-west', 'Single Line West'], ['mod-wren', 'Wren Quay'],
]

const TIMETABLE: Array<[string, string, string, number]> = [
  ['tt-1', 't101', 'st-wren', 720], ['tt-2', 't101', 'st-fernhill', 1500], ['tt-3', 't101', 'st-tarn', 2400],
  ['tt-4', 't202', 'st-tarn', 720], ['tt-5', 't202', 'st-fernhill', 1500], ['tt-6', 't202', 'st-wren', 2400],
  ['tt-7', 't303', 'st-wren', 900], ['tt-8', 't303', 'st-fernhill', 1800],
]

class Builder {
  readonly module: LayoutModule
  private cursor: string
  constructor(module: LayoutModule, private readonly newId: NewId, private readonly at: { block: number }) {
    this.module = module
    this.cursor = module.open_ends[0].id
  }

  private lay(body: PieceBody, forkFrom?: string): string[] {
    const piece = appendPiece(this.module, forkFrom ?? this.cursor, body, null, this.newId)
    piece.block_id = blockId(this.at.block)
    const ends = this.module.open_ends.filter(end => end.piece_id === piece.id)
    this.cursor = ends[0].id
    return ends.map(end => end.id)
  }

  straight(...lengths: number[]): this {
    for (const length of lengths) this.lay({ kind: 'straight', length_mm: length, rise_mm: 0, mainline: true })
    return this
  }

  curve(hand: Hand, angleDeg: number, count = 1, radius = RADIUS): this {
    for (let i = 0; i < count; i += 1) this.lay({ kind: 'curve', radius_mm: radius, angle_deg: angleDeg, hand, rise_mm: 0, mainline: true })
    return this
  }

  // Lays a turnout; the cursor stays on the through leg and the diverging end id is returned.
  turnout(hand: Hand): string {
    const [, diverging] = this.lay({ kind: 'turnout', frog_number: 6, hand, length_mm: 305, rise_mm: 0, mainline: true })
    return diverging
  }

  // Builds a branch from an open end, returns to the previous cursor and answers the branch's last open end.
  branch(from: string, block: number, build: (builder: Builder) => void): string {
    const saved = this.cursor
    const savedBlock = this.at.block
    this.cursor = from
    this.at.block = block
    build(this)
    const last = this.cursor
    this.cursor = saved
    this.at.block = savedBlock
    return last
  }

  block(number: number): this {
    this.at.block = number
    return this
  }

  // The module's last open end joins the next module (or a turnout's unused leg), so it stays closed.
  dropEnd(endId: string = this.cursor): void {
    this.module.open_ends = this.module.open_ends.filter(end => end.id !== endId)
  }

  end(): { x_mm: number; y_mm: number; heading_deg: number } {
    const end = this.module.open_ends.find(open => open.id === this.cursor)
    if (end === undefined) throw new Error('module has no open end')
    return { x_mm: end.x_mm, y_mm: end.y_mm, heading_deg: end.heading_deg }
  }
}

function plates(): LayoutModule['endplates'] {
  return [{ end: 'A', width_mm: 610, track_offsets_mm: [0] }, { end: 'B', width_mm: 610, track_offsets_mm: [0] }]
}

type Origin = { x_mm: number; y_mm: number; heading_deg: number }

function referenceModules(newId: NewId): LayoutModule[] {
  const position = { block: 3 }
  const make = (id: string, origin: Origin): Builder => {
    const name = MODULE_NAMES.find(([moduleId]) => moduleId === id)?.[1] ?? id
    return new Builder(newModule(id, name, plates(), origin, newId), newId, position)
  }

  // Wren Quay is laid westward from the junction so the platform road and the loop merge into the approach.
  const wren = make('mod-wren', { x_mm: 0, y_mm: 0, heading_deg: 180 })
  wren.block(3).straight(595, 600)
  const wrenLoop = wren.turnout('left')
  wren.block(1).straight(1000, 1000, 1000)
  wren.branch(wrenLoop, 2, b => b.curve('left', 20).straight(1343).curve('right', 29.53).straight(735))

  const west = make('mod-west', { x_mm: 0, y_mm: 0, heading_deg: 0 })
  west.block(4).straight(194).curve('left', 15, 12, FOLD_RADIUS).straight(194)

  const fernhill = make('mod-fernhill', west.end())
  fernhill.block(5).straight(595, 600)
  const fernhillLoop = fernhill.turnout('right')
  // The main road and the loop bow apart and meet again at the east throat, where T3 joins them into block 8.
  fernhill.block(6).curve('left', 30).straight(305).curve('right', 30).straight(154).curve('right', 30).straight(305).curve('left', 30)
  fernhill.block(8)
  const throatLoop = fernhill.turnout('right')
  fernhill.straight(595, 600)
  const loopEnd = fernhill.branch(fernhillLoop, 7, b => b.curve('right', 20.47).straight(305).curve('left', 30).straight(159).curve('left', 30).straight(326).curve('right', 30).straight(152))

  const east = make('mod-east', fernhill.end())
  east.block(9).straight(194).curve('right', 15, 12, FOLD_RADIUS).straight(194)

  const tarn = make('mod-tarn', east.end())
  tarn.block(10).straight(595, 600)
  const tarnLoop = tarn.turnout('left')
  tarn.block(11).straight(1000, 1000, 1000)
  tarn.branch(tarnLoop, 12, b => b.curve('left', 20).straight(1343).curve('right', 29.53).straight(735))

  fernhill.dropEnd(throatLoop)
  fernhill.dropEnd(loopEnd)
  west.dropEnd()
  fernhill.dropEnd()
  east.dropEnd()
  return [wren, west, fernhill, east, tarn].map(builder => builder.module)
}

function referenceTrains(): TrainSpec[] {
  return [
    { id: 't101', number: '101', name: 'Wren Quay Pickup', direction: 'east', speed_mph: 40, length_mm: 1200, start_block_id: blockId(1), head_offset_mm: 2800 },
    { id: 't202', number: '202', name: 'Tarn Head Mixed', direction: 'west', speed_mph: 40, length_mm: 1200, start_block_id: blockId(11), head_offset_mm: 2800 },
    { id: 't303', number: '303', name: 'Fernhill Shuttle', direction: 'east', speed_mph: 25, length_mm: 900, start_block_id: blockId(2), head_offset_mm: 2800 },
  ]
}

function referenceBlocks(): LayoutBlock[] {
  return BLOCKS.map(spec => ({
    id: blockId(spec.number), number: spec.number, name: spec.name, kind: spec.kind, module_id: spec.module,
    neighbour_ids: spec.neighbours.map(blockId),
  }))
}

function referenceStations(): Station[] {
  return [
    { id: 'st-fernhill', name: 'Fernhill', block_ids: [blockId(6), blockId(7)] },
    { id: 'st-tarn', name: 'Tarn Head', block_ids: [blockId(11), blockId(12)] },
    { id: 'st-wren', name: 'Wren Quay', block_ids: [blockId(1), blockId(2)] },
  ]
}

function referenceTurnouts(): LayoutTurnout[] {
  return [
    { id: 'T1', stem_block_id: blockId(3), normal_block_id: blockId(1), reverse_block_id: blockId(2) },
    { id: 'T2', stem_block_id: blockId(5), normal_block_id: blockId(6), reverse_block_id: blockId(7) },
    { id: 'T3', stem_block_id: blockId(8), normal_block_id: blockId(6), reverse_block_id: blockId(7) },
    { id: 'T4', stem_block_id: blockId(10), normal_block_id: blockId(11), reverse_block_id: blockId(12) },
  ]
}

function referenceTimetable(version: number, firstDepart: number): { version: number; entries: TimetableEntry[] } {
  return {
    version,
    entries: TIMETABLE.map(([id, train, station, depart]) => ({
      id, train_id: train, station_id: station, depart_fast_seconds: id === 'tt-1' ? firstDepart : depart,
    })),
  }
}

export function referenceContent(newId: NewId, timetableVersion: number, firstDepart: number): LayoutContent {
  return normalizeContent({
    modules: referenceModules(newId),
    blocks: referenceBlocks(),
    stations: referenceStations(),
    turnouts: referenceTurnouts(),
    trains: referenceTrains(),
    timetable: referenceTimetable(timetableVersion, firstDepart),
  })
}
