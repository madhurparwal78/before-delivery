import type { AvailabilityRecord, AvailabilityReason } from '../../shared/types.js';
import { serverNow } from '../clock.js';
import type { Db } from '../db.js';

/** The one place the username rules are decided. */

export const RESERVED_USERNAMES = ['halfpenny', 'postmaster', 'airfold'];

const ALLOWED = /^[a-z0-9_.]+$/;
const FIRST = /^[a-z]/;

export function normaliseUsername(raw: string): string {
  return raw.toLowerCase();
}

/** Syntax reasons, in the published order. */
export function syntaxReason(username: string): AvailabilityReason {
  if (username.length < 3 || username.length > 32) return 'length';
  if (!ALLOWED.test(username)) return 'characters';
  if (!FIRST.test(username)) return 'first_character';
  if (username.endsWith('.')) return 'last_character';
  return null;
}

export async function isTaken(db: Db, username: string): Promise<boolean> {
  if (RESERVED_USERNAMES.includes(username)) return true;
  const inUse = await db.query('select 1 from accounts where username = $1', [username]);
  if (inUse.rows.length > 0) return true;
  const held = await db.query(
    'select 1 from username_holds where username = $1 and held_until > $2',
    [username, serverNow()],
  );
  return held.rows.length > 0;
}

export async function availability(db: Db, raw: string): Promise<AvailabilityRecord> {
  const username = normaliseUsername(raw);
  const syntax = syntaxReason(username);
  if (syntax !== null) return { username, available: false, reason: syntax };
  if (await isTaken(db, username)) return { username, available: false, reason: 'taken' };
  return { username, available: true, reason: null };
}
