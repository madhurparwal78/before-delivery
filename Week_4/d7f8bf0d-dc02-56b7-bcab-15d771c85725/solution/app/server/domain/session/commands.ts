import type { Authority, Conflict, Direction } from '../../../shared/domain'
import { newId } from '../../canonical'
import { invalidFields, rule } from '../../http/errors'
import {
  closeConflicts, DEFAULT_TIME_LIMIT_S, endAuthority, grant, grantedFor, MAX_TIME_LIMIT_S, MIN_TIME_LIMIT_S, refuse,
} from './authority'
import { clearDeadlocksOf, openDeadlockOf } from './deadlock'
import { findRoute, firstBlocker } from './routing'
import { blockById, blockStates, trainById, type PinnedBlock, type SessionState, type StoredTrain } from './state'

// Session commands. Each mutates the state it is given and returns what the route handler needs for the event.

interface HighballRequest {
  destination_block_id: string
  via_block_id: string | null
  time_limit_fast_seconds: number
}

export function parseHighball(body: Record<string, unknown>, state: SessionState): HighballRequest {
  const fields: Record<string, string> = {}
  const destination = typeof body.destination_block_id === 'string' ? body.destination_block_id : ''
  if (!state.blocks.some(block => block.id === destination)) fields.destination_block_id = 'Choose a destination block.'
  const via = body.via_block_id === undefined || body.via_block_id === null || body.via_block_id === '' ? null : body.via_block_id
  if (via !== null && (typeof via !== 'string' || !state.blocks.some(block => block.id === via))) fields.via_block_id = 'Choose a block on this layout.'
  const limit = body.time_limit_fast_seconds === undefined ? DEFAULT_TIME_LIMIT_S : body.time_limit_fast_seconds
  if (!Number.isInteger(limit) || (limit as number) < MIN_TIME_LIMIT_S || (limit as number) > MAX_TIME_LIMIT_S) {
    fields.time_limit_fast_seconds = `Enter a whole number from ${MIN_TIME_LIMIT_S} to ${MAX_TIME_LIMIT_S}.`
  }
  if (Object.keys(fields).length > 0) throw invalidFields(fields)
  return { destination_block_id: destination, via_block_id: via as string | null, time_limit_fast_seconds: limit as number }
}

type HighballOutcome =
  | { granted: true; authority: Authority }
  | { granted: false; authority: Authority; conflict: Conflict; message: string; reachable_block_ids: string[] }

export function highball(state: SessionState, train: StoredTrain, request: HighballRequest, fastSeconds: number): HighballOutcome {
  const deadlock = openDeadlockOf(state, train.number)
  if (deadlock !== undefined && state.conflicts.some(conflict => conflict.state === 'Open' && conflict.train_id === train.id)) {
    throw deadlockOpen(deadlock.train_numbers)
  }
  if (grantedFor(state, train) !== undefined) throw rule('authority_active', `Train ${train.number} already has the road.`)
  const route = findRoute(state, train, request.destination_block_id, request.via_block_id)
  const blocker = firstBlocker(state, train, route)
  if (blocker === null) return { granted: true, authority: grant(state, train, route, fastSeconds, request.time_limit_fast_seconds) }
  const { authority, conflict } = refuse(state, train, route, blocker)
  const block = blockById(state, blocker.block_id)
  const message = blocker.other_train_number === null ? `${block.name} is out of service.` : `Train ${blocker.other_train_number} holds ${block.name}.`
  return { granted: false, authority, conflict, message, reachable_block_ids: route.slice(0, route.indexOf(blocker.block_id)) }
}

function deadlockOpen(numbers: string[]) {
  return rule('deadlock_open', `Trains ${numbers.join(', ')} are deadlocked. Use Back to loop or Recall.`)
}

export function cancelAuthority(state: SessionState, authority: Authority): void {
  if (authority.state !== 'Granted') throw rule('authority_ended', 'That authority has already ended.')
  const train = trainById(state, authority.train_id)
  if (train !== undefined && blockById(state, train.head_block_id).kind === 'approach') {
    throw rule('approach_locked', `Train ${train.number} is on the approach. The authority cannot be cancelled.`)
  }
  endAuthority(state, authority, 'Released', 'cancelled')
  if (train !== undefined) train.revision += 1
}

interface MoveDetail {
  train_id: string
  revoked_authority_ids: string[]
  closed_conflict_ids: string[]
  cleared_deadlock_ids: string[]
}

// Free for this train: free once the train and its own authority are set aside.
function freeForTrain(state: SessionState, block: PinnedBlock, train: StoredTrain): boolean {
  const without: SessionState = {
    ...state,
    trains: state.trains.filter(other => other.id !== train.id),
    authorities: state.authorities.filter(authority => authority.train_id !== train.id),
  }
  return blockStates(without).find(candidate => candidate.id === block.id)?.state === 'free'
}

function dispatcherMove(state: SessionState, train: StoredTrain, target: PinnedBlock, offsetMm: number): MoveDetail {
  const revoked = state.authorities.filter(authority => authority.state === 'Granted' && authority.train_id === train.id)
  for (const authority of revoked) endAuthority(state, authority, 'Revoked', 'moved')
  const closed = closeConflicts(state, conflict => conflict.train_id === train.id || conflict.other_train_id === train.id)
  const cleared = clearDeadlocksOf(state, train.number)
  train.head_block_id = target.id
  train.head_offset_mm = offsetMm
  train.trail_block_ids = [target.id]
  train.revision += 1
  return { train_id: train.id, revoked_authority_ids: revoked.map(a => a.id), closed_conflict_ids: closed, cleared_deadlock_ids: cleared }
}

function blocksBetween(state: SessionState, fromId: string, toId: string): number {
  const seen = new Set([fromId])
  let frontier = [fromId]
  for (let steps = 0; frontier.length > 0; steps += 1) {
    if (frontier.includes(toId)) return steps
    frontier = frontier.flatMap(id => blockById(state, id).neighbour_ids).filter(id => {
      if (seen.has(id) || !state.blocks.some(block => block.id === id)) return false
      seen.add(id)
      return true
    })
  }
  return Infinity
}

export function backToLoop(state: SessionState, train: StoredTrain): { block: PinnedBlock; detail: MoveDetail } {
  const loops = state.blocks.filter(block => block.kind === 'loop' && freeForTrain(state, block, train))
    .map(block => ({ block, distance: blocksBetween(state, train.head_block_id, block.id) }))
    .filter(candidate => candidate.distance !== Infinity)
    .sort((a, b) => a.distance - b.distance || a.block.number - b.block.number)
  if (loops.length === 0) throw rule('no_free_loop', `No loop is free for Train ${train.number}.`)
  const { block } = loops[0]
  return { block, detail: dispatcherMove(state, train, block, block.length_mm) }
}

export function recall(state: SessionState, train: StoredTrain): { block: PinnedBlock; detail: MoveDetail } {
  const block = blockById(state, train.start_block_id)
  if (!freeForTrain(state, block, train)) throw rule('recall_blocked', `${block.name} is not free.`)
  return { block, detail: dispatcherMove(state, train, block, train.start_offset_mm) }
}

export function parseExtraTrain(body: Record<string, unknown>, state: SessionState) {
  const fields: Record<string, string> = {}
  const number = typeof body.number === 'string' ? body.number.trim() : ''
  if (!/^[A-Za-z0-9-]{1,10}$/.test(number)) fields.number = 'Enter a train number of letters, digits or dashes.'
  else if (state.trains.some(train => train.number === number)) fields.number = 'That train number is already in this session.'
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (name === '' || name.length > 60) fields.name = 'Enter a train name of up to 60 characters.'
  const length = body.length_mm
  if (!Number.isInteger(length) || (length as number) < 300 || (length as number) > 2400) fields.length_mm = 'Length runs from 300 to 2400 mm.'
  const speed = body.speed_mph
  if (!Number.isInteger(speed) || (speed as number) < 5 || (speed as number) > 60) fields.speed_mph = 'Speed runs from 5 to 60 mph.'
  const direction = body.direction
  if (direction !== 'east' && direction !== 'west') fields.direction = 'Choose East or West.'
  const start = typeof body.start_block_id === 'string' ? state.blocks.find(block => block.id === body.start_block_id) : undefined
  if (start === undefined) fields.start_block_id = 'Choose a start block.'
  if (Object.keys(fields).length > 0) throw invalidFields(fields)
  return {
    number, name, length_mm: length as number, speed_mph: speed as number, direction: direction as Direction,
    start: start as PinnedBlock,
  }
}

export function addExtraTrain(state: SessionState, request: ReturnType<typeof parseExtraTrain>): StoredTrain {
  const free = blockStates(state).find(block => block.id === request.start.id)?.state === 'free'
  if (!free) throw rule('block_in_use', `${request.start.name} is in use.`)
  const train: StoredTrain = {
    id: newId('tx'),
    number: request.number,
    name: request.name,
    direction: request.direction,
    speed_mph: request.speed_mph,
    length_mm: request.length_mm,
    head_block_id: request.start.id,
    head_offset_mm: request.start.length_mm,
    trail_block_ids: [request.start.id],
    distance_run_mm: 0,
    carry: 0,
    authority_id: null,
    revision: 1,
    start_block_id: request.start.id,
    start_offset_mm: request.start.length_mm,
  }
  state.trains.push(train)
  return train
}

export function setBlockService(state: SessionState, block: PinnedBlock, outOfService: boolean): void {
  if (outOfService) {
    const current = blockStates(state).find(candidate => candidate.id === block.id)
    if (current?.state !== 'free') throw rule('block_in_use', `${block.name} is in use.`)
  }
  block.out_of_service = outOfService
}

export function throwTurnout(state: SessionState, turnoutId: string, position: 'normal' | 'reverse'): void {
  const turnout = state.turnouts.find(candidate => candidate.id === turnoutId)
  if (turnout === undefined) throw new Error(`turnout ${turnoutId} is not in the session`)
  if (turnout.locked_by_authority_id !== null) {
    const authority = state.authorities.find(candidate => candidate.id === turnout.locked_by_authority_id)
    const train = authority === undefined ? undefined : trainById(state, authority.train_id)
    throw rule('turnout_locked', `Turnout ${turnout.id} is locked by Train ${train?.number ?? ''}.`)
  }
  turnout.position = position
}

export function saveNote(conflict: Conflict, note: unknown): void {
  if (typeof note !== 'string' || note.length > 500) throw invalidFields({ note: 'Write a note of up to 500 characters.' })
  if (conflict.state !== 'Open') throw rule('conflict_closed', 'That conflict is closed.')
  conflict.note = note
  conflict.revision += 1
}

export function withdraw(state: SessionState, conflict: Conflict): void {
  const train = trainById(state, conflict.train_id)
  const deadlock = train === undefined ? undefined : openDeadlockOf(state, train.number)
  if (deadlock !== undefined) throw deadlockOpen(deadlock.train_numbers)
  if (conflict.state !== 'Open') throw rule('conflict_closed', 'That conflict is closed.')
  closeConflicts(state, candidate => candidate.id === conflict.id)
}
