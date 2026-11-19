import type { Authority } from '../../../shared/domain'
import { blockById, type SessionState, type StoredTrain } from './state'

// Scale speed: HO is 1:87.1. Per train per tick, total = mph * 16093440 + carry, advance = floor(total / 3135600),
// carry = total mod 3135600. This is the only place the formula lives.
const SPEED_FACTOR = 16_093_440
const SPEED_DIVISOR = 3_135_600

export function scaleAdvance(speedMph: number, carry: number): { advance_mm: number; carry: number } {
  const total = speedMph * SPEED_FACTOR + carry
  return { advance_mm: Math.floor(total / SPEED_DIVISOR), carry: total % SPEED_DIVISOR }
}

function nextBlockInRoute(train: StoredTrain, authority: Authority): string | undefined {
  const at = authority.block_ids.indexOf(train.head_block_id)
  return authority.block_ids[at + 1]
}

// Moves the head along the granted route; stops at the end of the last granted block. Returns the blocks entered.
export function moveHead(state: SessionState, train: StoredTrain, authority: Authority, advanceMm: number): string[] {
  const entered: string[] = []
  let remaining = advanceMm
  for (;;) {
    const length = blockById(state, train.head_block_id).length_mm
    const room = length - train.head_offset_mm
    if (room >= remaining) {
      train.head_offset_mm += remaining
      train.distance_run_mm += remaining
      break
    }
    const next = nextBlockInRoute(train, authority)
    train.head_offset_mm = length
    train.distance_run_mm += room
    if (next === undefined) break
    remaining -= room
    train.head_block_id = next
    train.head_offset_mm = 0
    train.trail_block_ids = [next, ...train.trail_block_ids]
    entered.push(next)
  }
  return entered
}

// The trail keeps only the blocks the train still lies in (plus the head).
export function pruneTrail(state: SessionState, train: StoredTrain): void {
  let covered = 0
  const kept: string[] = []
  for (const [index, blockId] of train.trail_block_ids.entries()) {
    kept.push(blockId)
    covered += index === 0 ? train.head_offset_mm : blockById(state, blockId).length_mm
    if (covered >= train.length_mm) break
  }
  train.trail_block_ids = kept
}
