import { alreadyDriving, batonTaken, sessionNotLive } from '../http/errors.js';
import type { SessionState } from '../../shared/api.js';

export interface BatonState {
  state: SessionState;
  version: number;
  /** A live session always has a driver. */
  driver: { id: string; name: string } | null;
}

/**
 * The one place a baton claim or pass is judged. The order of conflicts is
 * session_not_live, then already_driving, then baton_taken.
 */
export function checkBatonChange(
  current: BatonState,
  requestedVersion: number,
  targetUserId: string,
): void {
  if (current.state !== 'live' || current.driver === null) throw sessionNotLive(current.state);
  if (current.driver.id === targetUserId) throw alreadyDriving();
  if (current.version !== requestedVersion) {
    throw batonTaken(current.driver.id, current.driver.name, current.version);
  }
}
