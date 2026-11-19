import { notFound, refuse } from '../http/errors';
import type { Reader } from '../domain/model';
import type { Caller, Role } from './types';

/**
 * The one place that decides what a role may reach. A record that belongs to
 * someone else and a record that never existed both answer not-found.
 */

/** A collection a role may not reach at all answers 403. */
export function onlyRoles(caller: Caller, roles: readonly Role[]): void {
  if (!roles.includes(caller.role)) throw refuse('forbidden');
}

export function isSailmaker(caller: Caller): boolean {
  return caller.role === 'sailmaker';
}

/** Drawings a loft hand may reach are the ones assigned to them. */
export async function drawingVisible(
  db: Reader,
  caller: Caller,
  drawing: { code: string; assigned_to: string | null },
  now: Date,
): Promise<boolean> {
  if (caller.role === 'sailmaker') return true;
  if (caller.role === 'loft-hand') return drawing.assigned_to === caller.email;
  const grant = await db.one<{ id: string }>(
    `SELECT id FROM sight_grant
      WHERE drawing_code = $1 AND owner_email = $2 AND status = 'granted'
        AND (ends_at IS NULL OR ends_at > $3)`,
    [drawing.code, caller.email, now.toISOString()],
  );
  return grant !== null;
}

/** Boats a loft hand may reach are the boats of their assigned drawings. */
export async function boatVisible(
  db: Reader,
  caller: Caller,
  boat: { code: string; owner_email: string },
): Promise<boolean> {
  if (caller.role === 'sailmaker') return true;
  if (caller.role === 'yacht-owner') return boat.owner_email === caller.email;
  const assigned = await db.one<{ code: string }>(
    'SELECT code FROM drawing WHERE boat_code = $1 AND assigned_to = $2 LIMIT 1',
    [boat.code, caller.email],
  );
  return assigned !== null;
}

/** Stock a loft hand may reach is the stock of their assigned drawings' cloth. */
export async function stockVisible(
  db: Reader,
  caller: Caller,
  stock: { code: string; cloth_code: string },
): Promise<boolean> {
  if (caller.role === 'sailmaker') return true;
  if (caller.role === 'yacht-owner') return false;
  const assigned = await db.one<{ code: string }>(
    'SELECT code FROM drawing WHERE cloth_code = $1 AND assigned_to = $2 LIMIT 1',
    [stock.cloth_code, caller.email],
  );
  return assigned !== null;
}

export function requireVisible<T>(record: T | null, visible: boolean): T {
  if (record === null || !visible) throw notFound();
  return record;
}

/** Owners receive the published owner projection on every address. */
export function asOwner(caller: Caller): boolean {
  return caller.role === 'yacht-owner';
}
