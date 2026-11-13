import { plateFor } from '../shared/copy.js';
import type { HoldResponse } from '../shared/types.js';
import { announceBox, moveBox, storedBoxState, syncSearch } from './boxes.js';
import { editionClosed } from './clock.js';
import { config } from './config.js';
import { pool } from './db.js';
import { fail, failForBox } from './errors.js';
import { liveOrderForBox, newToken } from './orders.js';
import { readHold, releaseHold, takeHold, valkeyUp } from './services/valkey.js';

export const holdMs = config.holdSeconds * 1000;

function requireValkey(): void {
  if (!valkeyUp()) throw fail(503, 'sales_paused');
}

async function mirrorHeld(boxNumber: number): Promise<void> {
  const state = await storedBoxState(boxNumber);
  if (state === 'available') {
    await moveBox(pool, boxNumber, 'available', 'held');
    announceBox(boxNumber, 'held');
    await syncSearch([boxNumber]);
  }
}

async function mirrorAvailable(boxNumber: number): Promise<void> {
  const state = await storedBoxState(boxNumber);
  if (state === 'held') {
    await moveBox(pool, boxNumber, 'held', 'available');
    announceBox(boxNumber, 'available');
    await syncSearch([boxNumber]);
  }
}

export interface GrantedHold extends HoldResponse {
  fresh: boolean;
}

/** Exactly one reach for a number wins; every other reach is refused. */
export async function grantHold(boxNumber: number, offeredToken: string | null): Promise<GrantedHold> {
  const stored = await storedBoxState(boxNumber);
  if (stored === null) throw fail(404, 'not_found');
  const claimed = await liveOrderForBox(boxNumber);
  if (claimed !== null) throw failForBox(409, 'box_taken', boxNumber);
  if (stored !== 'available' && stored !== 'held') throw failForBox(409, 'box_taken', boxNumber);
  if (editionClosed()) throw fail(409, 'edition_closed');
  requireValkey();

  const existing = await readHold(boxNumber);
  if (existing !== null) {
    if (offeredToken !== null && existing.token === offeredToken) {
      return {
        number: boxNumber,
        plate: plateFor(boxNumber),
        holdToken: existing.token,
        holdMs,
        remainingMs: existing.remainingMs,
        fresh: false,
      };
    }
    throw failForBox(409, 'box_held', boxNumber);
  }

  const token = newToken();
  const won = await takeHold(boxNumber, token, config.holdSeconds);
  if (!won) throw failForBox(409, 'box_held', boxNumber);
  await mirrorHeld(boxNumber);
  return {
    number: boxNumber,
    plate: plateFor(boxNumber),
    holdToken: token,
    holdMs,
    remainingMs: holdMs,
    fresh: true,
  };
}

export async function holdRemainingMs(boxNumber: number, token: string): Promise<number | null> {
  if (!valkeyUp()) return null;
  const existing = await readHold(boxNumber);
  if (existing === null || existing.token !== token) return null;
  return existing.remainingMs;
}

export async function readOwnHold(boxNumber: number, token: string): Promise<number> {
  requireValkey();
  const existing = await readHold(boxNumber);
  if (existing === null) throw failForBox(410, 'hold_ended', boxNumber);
  if (existing.token !== token) throw fail(403, 'hold_not_yours');
  return existing.remainingMs;
}

export async function putBoxBack(boxNumber: number, token: string): Promise<void> {
  await readOwnHold(boxNumber, token);
  await releaseHold(boxNumber);
  await mirrorAvailable(boxNumber);
}

/** The hold is consumed the moment it becomes a claim. */
export async function consumeHold(boxNumber: number): Promise<void> {
  await releaseHold(boxNumber);
}

export { mirrorAvailable };
