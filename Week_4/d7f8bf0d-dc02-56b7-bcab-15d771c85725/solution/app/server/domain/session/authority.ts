import type { Authority, Conflict, EndedReason } from '../../../shared/domain'
import { newId } from '../../canonical'
import { crossings, type RouteBlocker } from './routing'
import { grantedAuthorities, type SessionState, type StoredTrain } from './state'

// Authority lifecycle: Requested moves in the same commit to Granted or Refused, then a Granted authority ends
// as Released or Revoked.

export const DEFAULT_TIME_LIMIT_S = 3600
export const MIN_TIME_LIMIT_S = 6
export const MAX_TIME_LIMIT_S = 43_200

export function closeConflicts(state: SessionState, shouldClose: (conflict: Conflict) => boolean): string[] {
  const closed: string[] = []
  for (const conflict of state.conflicts) {
    if (conflict.state === 'Open' && shouldClose(conflict)) {
      conflict.state = 'Closed'
      conflict.revision += 1
      closed.push(conflict.id)
    }
  }
  return closed
}

export function grant(state: SessionState, train: StoredTrain, route: string[], fastSeconds: number, limitSeconds: number): Authority {
  const authority: Authority = {
    id: newId('au'),
    train_id: train.id,
    state: 'Granted',
    block_ids: route,
    remaining_block_ids: route,
    limit_block_id: route[route.length - 1],
    expires_fast_seconds: fastSeconds + limitSeconds,
    ended_reason: null,
    revision: 1,
  }
  state.authorities.push(authority)
  train.authority_id = authority.id
  train.revision += 1
  for (const crossing of crossings(state, train.head_block_id, route)) {
    const turnout = state.turnouts.find(candidate => candidate.id === crossing.turnout.id)
    if (turnout !== undefined) {
      turnout.position = crossing.position
      turnout.locked_by_authority_id = authority.id
    }
  }
  closeConflicts(state, conflict => conflict.train_id === train.id)
  return authority
}

export function refuse(state: SessionState, train: StoredTrain, route: string[], blocker: RouteBlocker): { authority: Authority; conflict: Conflict } {
  const authority: Authority = {
    id: newId('au'),
    train_id: train.id,
    state: 'Refused',
    block_ids: route,
    remaining_block_ids: [],
    limit_block_id: route[route.length - 1],
    expires_fast_seconds: 0,
    ended_reason: null,
    revision: 1,
  }
  const other = blocker.other_train_number === null ? null : state.trains.find(candidate => candidate.number === blocker.other_train_number)
  const conflict: Conflict = {
    id: newId('cf'),
    state: 'Open',
    train_id: train.id,
    other_train_id: other?.id ?? null,
    block_id: blocker.block_id,
    note: '',
    revision: 1,
  }
  closeConflicts(state, existing => existing.train_id === train.id)
  state.authorities.push(authority)
  state.conflicts.push(conflict)
  train.revision += 1
  return { authority, conflict }
}

export function unlockTurnouts(state: SessionState, authorityId: string): void {
  for (const turnout of state.turnouts) {
    if (turnout.locked_by_authority_id === authorityId) turnout.locked_by_authority_id = null
  }
}

export function endAuthority(state: SessionState, authority: Authority, endedState: 'Released' | 'Revoked', reason: EndedReason): void {
  authority.state = endedState
  authority.ended_reason = reason
  authority.remaining_block_ids = []
  authority.revision += 1
  const train = state.trains.find(candidate => candidate.id === authority.train_id)
  if (train !== undefined && train.authority_id === authority.id) train.authority_id = null
  unlockTurnouts(state, authority.id)
}

export function grantedFor(state: SessionState, train: StoredTrain): Authority | undefined {
  return grantedAuthorities(state).find(authority => authority.train_id === train.id)
}
