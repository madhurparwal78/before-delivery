import type { Authority, TickDetail } from '../../../shared/domain'
import { endAuthority, unlockTurnouts } from './authority'
import { raiseDeadlocks } from './deadlock'
import { moveHead, pruneTrail, scaleAdvance } from './movement'
import { blockById, fastClockSeconds, grantedAuthorities, occupiedBlockIds, trainById, type SessionState, type StoredTrain } from './state'

function giveBackBlocks(state: SessionState, authority: Authority, train: StoredTrain): void {
  const occupied = new Set(occupiedBlockIds(train, state))
  const reached = authority.block_ids.indexOf(train.head_block_id)
  authority.remaining_block_ids = authority.block_ids.filter((id, index) => index > reached || occupied.has(id))
}

function releaseClearedTurnouts(state: SessionState, authority: Authority): void {
  for (const turnout of state.turnout_defs) {
    const locked = state.turnouts.find(candidate => candidate.id === turnout.id)?.locked_by_authority_id === authority.id
    const touching = [turnout.stem_block_id, turnout.normal_block_id, turnout.reverse_block_id].filter(id => authority.block_ids.includes(id))
    if (locked && !touching.some(id => authority.remaining_block_ids.includes(id))) unlockTurnouts(state, authority.id)
  }
}

// One committed tick, in the published order: trains advance, occupancy and given-back blocks are derived,
// timetable arrivals are recorded, authorities that reached their limit end, authorities that expired are
// revoked, and the wait-for graph is checked.
export function applyTick(state: SessionState, ratio: number, tick: number): TickDetail {
  const fast = fastClockSeconds(tick, ratio)
  const detail: TickDetail = { tick, arrivals: [], authorities_released: [], authorities_revoked: [], deadlocks_raised: [] }
  const entered = new Map<string, string[]>()
  for (const authority of grantedAuthorities(state)) {
    const train = trainById(state, authority.train_id)
    if (train === undefined) continue
    const step = scaleAdvance(train.speed_mph, train.carry)
    train.carry = step.carry
    entered.set(train.id, moveHead(state, train, authority, step.advance_mm))
    pruneTrail(state, train)
    giveBackBlocks(state, authority, train)
    releaseClearedTurnouts(state, authority)
  }
  for (const [trainId, blocks] of entered) {
    const train = trainById(state, trainId)
    if (train === undefined) continue
    for (const entry of state.timetable.filter(candidate => candidate.train_id === trainId)) {
      const station = state.stations.find(candidate => candidate.id === entry.station_id)
      const progress = state.timetable_progress.find(candidate => candidate.entry_id === entry.id)
      if (station === undefined || progress === undefined || progress.arrived_fast_seconds !== null) continue
      if (blocks.some(blockId => station.block_ids.includes(blockId))) {
        progress.arrived_fast_seconds = fast
        detail.arrivals.push({ entry_id: entry.id, train_number: train.number, arrived_fast_seconds: fast })
      }
    }
  }
  for (const authority of grantedAuthorities(state)) {
    const train = trainById(state, authority.train_id)
    if (train !== undefined && train.head_block_id === authority.limit_block_id
      && train.head_offset_mm === blockById(state, authority.limit_block_id).length_mm) {
      endAuthority(state, authority, 'Released', 'completed')
      detail.authorities_released.push({ id: authority.id, train_number: train.number, ended_reason: 'completed' })
    }
  }
  for (const authority of grantedAuthorities(state)) {
    if (fast >= authority.expires_fast_seconds) {
      endAuthority(state, authority, 'Revoked', 'expired')
      detail.authorities_revoked.push({ id: authority.id, train_number: trainById(state, authority.train_id)?.number ?? '', ended_reason: 'expired' })
    }
  }
  detail.deadlocks_raised = raiseDeadlocks(state, tick).map(deadlock => ({ id: deadlock.id, train_numbers: deadlock.train_numbers }))
  return detail
}
