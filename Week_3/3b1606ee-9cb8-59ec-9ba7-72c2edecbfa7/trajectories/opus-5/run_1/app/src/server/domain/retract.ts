import { RETRACT_WINDOW_MS } from '../config.js';
import type { LetterRow } from './letters.js';

/** The one place the retract window is decided. */
export function retractWindowOpen(heldAt: Date, now: Date): boolean {
  return now.getTime() < heldAt.getTime() + RETRACT_WINDOW_MS;
}

export function canRetract(row: LetterRow, callerId: string, now: Date): boolean {
  return (
    row.sender_id === callerId &&
    row.retracted_at === null &&
    retractWindowOpen(row.held_at, now)
  );
}
