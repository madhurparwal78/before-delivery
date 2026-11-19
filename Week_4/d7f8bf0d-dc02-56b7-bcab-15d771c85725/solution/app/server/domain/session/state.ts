import type {
  Authority, BlockKind, BlockState, Conflict, Counters, Deadlock, Direction, HoldReason, LayoutTurnout, SessionBlock,
  SessionSnapshot, SessionStatus, SessionTurnout, SessionTrain, Station, TimetableEntry, TimetableProgress,
} from '../../../shared/domain'

// Persisted session state, and the one place where block state, occupancy and counters are derived from it.

export interface PinnedBlock {
  id: string
  number: number
  name: string
  kind: BlockKind
  length_mm: number
  neighbour_ids: string[]
  out_of_service: boolean
}

export interface StoredTrain {
  id: string
  number: string
  name: string
  direction: Direction
  speed_mph: number
  length_mm: number
  head_block_id: string
  head_offset_mm: number
  trail_block_ids: string[]
  distance_run_mm: number
  carry: number
  authority_id: string | null
  revision: number
  start_block_id: string
  start_offset_mm: number
}

export interface SessionState {
  blocks: PinnedBlock[]
  stations: Station[]
  turnout_defs: LayoutTurnout[]
  timetable: TimetableEntry[]
  trains: StoredTrain[]
  turnouts: SessionTurnout[]
  authorities: Authority[]
  conflicts: Conflict[]
  deadlocks: Deadlock[]
  timetable_progress: TimetableProgress[]
}

export interface SessionRow {
  id: string
  workspace_id: string
  layout_id: string
  name: string
  status: SessionStatus
  hold_reason: HoldReason
  ratio: number
  revision: number
  control_revision: number
  session_version: number
  tick: number
  last_tick_at: Date | null
  layout_version_id: string
  layout_version_number: number
  timetable_version: number
  state: SessionState
}

export function blockById(state: SessionState, id: string): PinnedBlock {
  const block = state.blocks.find(candidate => candidate.id === id)
  if (block === undefined) throw new Error(`block ${id} is not in the session`)
  return block
}

export function trainById(state: SessionState, id: string): StoredTrain | undefined {
  return state.trains.find(train => train.id === id)
}

export function grantedAuthorities(state: SessionState): Authority[] {
  return state.authorities.filter(authority => authority.state === 'Granted')
}

export const fastClockSeconds = (tick: number, ratio: number): number => tick * ratio

export function fastClockLabel(seconds: number): string {
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${pad(Math.floor(seconds / 3600))}:${pad(Math.floor(seconds / 60) % 60)}:${pad(seconds % 60)}`
}

// A train occupies a block when any positive length of the train lies in it, walking back from the head along the trail.
export function occupiedBlockIds(train: StoredTrain, state: SessionState): string[] {
  const occupied: string[] = []
  let left = train.length_mm
  train.trail_block_ids.forEach((blockId, index) => {
    const stretch = index === 0 ? train.head_offset_mm : blockById(state, blockId).length_mm
    if (left > 0 && stretch > 0) occupied.push(blockId)
    left -= stretch
  })
  return occupied
}

function reservedBlockIds(state: SessionState): Set<string> {
  return new Set(grantedAuthorities(state).flatMap(authority => authority.remaining_block_ids))
}

// Block state is decided in this order: out of service, occupied, reserved, free.
export function blockStates(state: SessionState): SessionBlock[] {
  const occupant = new Map<string, string>()
  for (const train of state.trains) for (const id of occupiedBlockIds(train, state)) occupant.set(id, train.number)
  const reserved = reservedBlockIds(state)
  const covering = (blockId: string): string | null =>
    grantedAuthorities(state).find(authority => authority.remaining_block_ids.includes(blockId))?.id ?? null
  return [...state.blocks].sort((a, b) => a.number - b.number).map(block => {
    const blockState: BlockState = block.out_of_service ? 'out_of_service'
      : occupant.has(block.id) ? 'occupied' : reserved.has(block.id) ? 'reserved' : 'free'
    return {
      id: block.id,
      number: block.number,
      name: block.name,
      kind: block.kind,
      length_mm: block.length_mm,
      state: blockState,
      train_number: block.out_of_service ? null : occupant.get(block.id) ?? null,
      authority_id: covering(block.id),
    }
  })
}

function countersOf(blocks: SessionBlock[], state: SessionState): Counters {
  const count = (states: BlockState[]): number => blocks.filter(block => states.includes(block.state)).length
  return {
    occupied_blocks: count(['occupied', 'out_of_service']),
    reserved_blocks: count(['reserved']),
    free_blocks: count(['free']),
    trains: state.trains.length,
    open_conflicts: state.conflicts.filter(conflict => conflict.state === 'Open').length,
  }
}

function snapshotTrain(train: StoredTrain, state: SessionState): SessionTrain {
  return {
    id: train.id,
    number: train.number,
    name: train.name,
    direction: train.direction,
    speed_mph: train.speed_mph,
    length_mm: train.length_mm,
    head_block_id: train.head_block_id,
    head_offset_mm: train.head_offset_mm,
    trail_block_ids: train.trail_block_ids,
    occupied_block_ids: occupiedBlockIds(train, state),
    distance_run_mm: train.distance_run_mm,
    carry: train.carry,
    authority_id: train.authority_id,
    revision: train.revision,
  }
}

export function positionsOf(state: SessionState): Array<Record<string, unknown>> {
  return state.trains.map(train => ({
    train_id: train.id,
    number: train.number,
    head_block_id: train.head_block_id,
    head_offset_mm: train.head_offset_mm,
    trail_block_ids: train.trail_block_ids,
    distance_run_mm: train.distance_run_mm,
    carry: train.carry,
  }))
}

export function buildSnapshot(row: SessionRow): SessionSnapshot {
  const { state } = row
  const blocks = blockStates(state)
  const fast = fastClockSeconds(row.tick, row.ratio)
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    hold_reason: row.hold_reason,
    ratio: row.ratio,
    revision: row.revision,
    control_revision: row.control_revision,
    session_version: row.session_version,
    tick: row.tick,
    fast_clock_seconds: fast,
    fast_clock_label: fastClockLabel(fast),
    layout_version_id: row.layout_version_id,
    layout_version_number: row.layout_version_number,
    timetable_version: row.timetable_version,
    trains: state.trains.map(train => snapshotTrain(train, state)),
    blocks,
    turnouts: state.turnouts,
    authorities: state.authorities,
    conflicts: state.conflicts,
    deadlocks: state.deadlocks,
    timetable_progress: state.timetable_progress,
    counters: countersOf(blocks, state),
  }
}
