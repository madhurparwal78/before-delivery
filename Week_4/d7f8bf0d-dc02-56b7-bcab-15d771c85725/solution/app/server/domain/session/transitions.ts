import type { SessionStatus } from '../../../shared/domain'
import { canAddExtraTrain, isActive, nextStatus, type SessionCommand, type StatusPair } from '../../../shared/session-states'
import { rule } from '../../http/errors'

export function transitionOrRefuse(current: StatusPair, command: SessionCommand): StatusPair {
  const next = nextStatus(current, command)
  if (next === null) throw rule('session_transition', `A ${current.status} session cannot do that.`)
  return next
}

export function requireActive(status: SessionStatus): void {
  if (!isActive(status)) throw rule('session_not_active', 'This session is not running.')
}

export function requireCanAddTrain(status: SessionStatus): void {
  if (!canAddExtraTrain(status)) throw rule('session_transition', `A ${status} session cannot do that.`)
}
