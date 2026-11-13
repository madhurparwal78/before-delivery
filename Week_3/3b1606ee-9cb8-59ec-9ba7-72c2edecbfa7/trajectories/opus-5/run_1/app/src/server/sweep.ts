import { serverNow } from './clock.js';
import { pool } from './db.js';
import { markReturned } from './domain/delivery.js';
import { pushLetter } from './push.js';
import { deleteObject } from './storage.js';

/** Returns uncollected letters, deletes what they held, and tells both browsers. */
export async function sweepReturns(): Promise<void> {
  const returned = await markReturned(pool, serverNow());
  for (const letter of returned) {
    if (letter.attachment_id !== null) {
      await deleteObject(letter.sender_id, letter.attachment_id);
    }
    await pushLetter(letter);
  }
}

export function startSweep(): NodeJS.Timeout {
  const timer = setInterval(() => {
    void sweepReturns();
  }, 10_000);
  timer.unref();
  return timer;
}
