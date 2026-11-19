import type { HoldReason, SessionStatus } from './domain'

// The published session state machine: the one place where a status may change, used by the server to decide and by
// the Session controls to know which commands are legal.

export type SessionCommand = 'start' | 'hold' | 'resume' | 'end'
export type SessionCause = SessionCommand | 'valkey_down' | 'valkey_up' | 'lease_lost'

export interface StatusPair { status: SessionStatus; hold_reason: HoldReason }

export function nextStatus(current: StatusPair, cause: SessionCause): StatusPair | null {
  const { status, hold_reason: reason } = current
  switch (cause) {
    case 'start':
      return status === 'Scheduled' ? { status: 'Running', hold_reason: null } : null
    case 'hold':
      return status === 'Running' ? { status: 'Held', hold_reason: 'operator' } : null
    case 'resume':
      return (status === 'Held' && reason === 'operator') || status === 'Interrupted' ? { status: 'Running', hold_reason: null } : null
    case 'end':
      return status === 'Running' || status === 'Held' || status === 'Interrupted' ? { status: 'Ended', hold_reason: null } : null
    case 'valkey_down':
      return status === 'Running' ? { status: 'Held', hold_reason: 'valkey' } : null
    case 'valkey_up':
      return status === 'Held' && reason === 'valkey' ? { status: 'Running', hold_reason: null } : null
    case 'lease_lost':
      return status === 'Running' ? { status: 'Interrupted', hold_reason: null } : null
  }
}

// Train, authority, block and turnout commands are legal while Running or Held.
export const isActive = (status: SessionStatus): boolean => status === 'Running' || status === 'Held'

// An extra train may be added while Scheduled, Running or Held.
export const canAddExtraTrain = (status: SessionStatus): boolean => status === 'Scheduled' || isActive(status)
