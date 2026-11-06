import type { SessionState } from '../../shared/api.js';
import { notDriver, sessionPaused } from '../http/errors.js';

export interface BlockingSession {
  state: SessionState;
  driverId: string | null;
}

/**
 * The one place the write rule is decided. A write is a file create, content save,
 * delete, restore or restore undo.
 */
export function assertMayWrite(session: BlockingSession | null, userId: string): void {
  if (session === null) return;
  if (session.state === 'paused') throw sessionPaused();
  if (session.driverId !== userId) throw notDriver(session.driverId);
}
