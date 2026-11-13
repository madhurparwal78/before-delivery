// Applies returns (letters uncollected for 30 days) on every affected read and by a sweep at least every 10 seconds.
import { applyReturns } from './conversations.js';
import type { Hub } from './hub.js';
import { serializeLetter } from './serialize.js';
import type { LetterRecord } from './conversations.js';

let hub: Hub | null = null;
let timer: NodeJS.Timeout | null = null;

export function startSweep(h: Hub): void {
  hub = h;
  timer = setInterval(() => { void sweep(); }, 10_000);
  timer.unref();
}

export function stopSweep(): void {
  if (timer) clearInterval(timer);
  timer = null;
  hub = null;
}

export async function sweep(): Promise<void> {
  const returned = await applyReturns();
  for (const letter of returned) {
    for (const accountId of [letter.sender_id, letter.recipient_id]) {
      hub?.send(accountId, { type: 'letter', letter: serializeLetter(letter, accountId) });
    }
  }
}
