import type { LayoutContent } from '../../../shared/domain'
import { blockLengths } from '../../../shared/blockpaths'
import type { SessionState, StoredTrain } from './state'

// A session is pinned at creation to one version's blocks, stations, trains, turnouts and timetable, with that version's names.
export function pinContent(content: LayoutContent): SessionState {
  const lengths = blockLengths(content)
  const trains: StoredTrain[] = content.trains.map(spec => ({
    id: spec.id,
    number: spec.number,
    name: spec.name,
    direction: spec.direction,
    speed_mph: spec.speed_mph,
    length_mm: spec.length_mm,
    head_block_id: spec.start_block_id,
    head_offset_mm: spec.head_offset_mm,
    trail_block_ids: [spec.start_block_id],
    distance_run_mm: 0,
    carry: 0,
    authority_id: null,
    revision: 1,
    start_block_id: spec.start_block_id,
    start_offset_mm: spec.head_offset_mm,
  }))
  return {
    blocks: content.blocks.map(block => ({
      id: block.id,
      number: block.number,
      name: block.name,
      kind: block.kind,
      length_mm: lengths.get(block.id) ?? 0,
      neighbour_ids: block.neighbour_ids,
      out_of_service: false,
    })),
    stations: content.stations,
    turnout_defs: content.turnouts,
    timetable: content.timetable.entries,
    trains,
    turnouts: content.turnouts.map(turnout => ({ id: turnout.id, position: 'normal', locked_by_authority_id: null })),
    authorities: [],
    conflicts: [],
    deadlocks: [],
    timetable_progress: content.timetable.entries.map(entry => ({ entry_id: entry.id, arrived_fast_seconds: null })),
  }
}
