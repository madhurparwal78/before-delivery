// Stock holds: the hold window runs on the server clock and a hold returns its units exactly once.
import { randomUUID } from "node:crypto";
import { config } from "./config.js";
import { type Db, one, pool, query, required, transaction } from "./db.js";
import { ApiError, invalidTransition, notFound } from "./errors.js";
import { byCodePoint, isUuid } from "./json.js";
import { claimForHold, releaseHeld } from "./stock.js";
import type { HoldStatus } from "../shared/transitions.js";
import type { SessionUser } from "./auth.js";

type ReleaseReason = "window_ended" | "deleted" | "cart_changed";

export interface HoldRow {
  id: string;
  user_id: string;
  store_id: string;
  status: HoldStatus;
  created_at: Date;
  expires_at: Date;
  released_at: Date | null;
  release_reason: ReleaseReason | null;
}

export const HOLD_COLUMNS = "id, user_id, store_id, status, created_at, expires_at, released_at, release_reason";

export async function holdLines(db: Pick<Db, "query">, holdId: string): Promise<{ sku: string; quantity: number }[]> {
  const rows = await query<{ sku: string; quantity: number }>(db, "SELECT sku, quantity FROM hold_lines WHERE hold_id = $1", [holdId]);
  return rows.sort((a, b) => byCodePoint(a.sku, b.sku));
}

export async function holdObject(db: Pick<Db, "query">, hold: HoldRow, now: Date) {
  const left = hold.status === "active" ? Math.max(0, Math.ceil((hold.expires_at.getTime() - now.getTime()) / 1000)) : 0;
  return {
    id: hold.id, status: hold.status, store_id: hold.store_id, lines: await holdLines(db, hold.id),
    created_at: hold.created_at.toISOString(), expires_at: hold.expires_at.toISOString(), seconds_left: left,
    released_at: hold.released_at ? hold.released_at.toISOString() : null,
  };
}

/** Moves an active hold to released and returns its units, once: whoever flips the status wins and the rest change nothing. */
export async function releaseHold(db: Db, holdId: string, reason: ReleaseReason, now: Date): Promise<boolean> {
  const flipped = await one<{ store_id: string }>(db,
    "UPDATE holds SET status = 'released', released_at = $2, release_reason = $3 WHERE id = $1 AND status = 'active' RETURNING store_id",
    [holdId, now, reason]);
  if (!flipped) return false;
  await releaseHeld(db, flipped.store_id, await holdLines(db, holdId));
  return true;
}

/** A hold has ended at and after its expiry instant. */
export function windowEnded(hold: Pick<HoldRow, "expires_at">, now: Date): boolean {
  return now.getTime() >= hold.expires_at.getTime();
}

/** Loads a hold that belongs to this shopper, releasing it first when its window has ended. */
export async function loadOwnHold(user: SessionUser, id: unknown, now: Date): Promise<HoldRow> {
  if (!isUuid(id)) throw notFound();
  const found = await one<HoldRow>(pool, `SELECT ${HOLD_COLUMNS} FROM holds WHERE id = $1 AND user_id = $2`, [id, user.id]);
  if (!found) throw notFound();
  if (found.status === "active" && windowEnded(found, now)) {
    await transaction((db) => releaseHold(db, found.id, "window_ended", now));
    return requireHoldRow(pool, found.id);
  }
  return found;
}

export async function activeHold(db: Pick<Db, "query">, userId: string): Promise<HoldRow | null> {
  return one<HoldRow>(db, `SELECT ${HOLD_COLUMNS} FROM holds WHERE user_id = $1 AND status = 'active'`, [userId]);
}

export async function sweepHolds(now: Date): Promise<void> {
  const due = await query<{ id: string }>(pool, "SELECT id FROM holds WHERE status = 'active' AND expires_at <= $1 ORDER BY id", [now]);
  for (const hold of due) await transaction((db) => releaseHold(db, hold.id, "window_ended", now));
}

export async function createHold(db: Db, user: SessionUser, shopId: string, lines: { sku: string; quantity: number }[], now: Date): Promise<HoldRow> {
  const id = randomUUID();
  const expires = new Date(now.getTime() + config.holdSeconds * 1000);
  try {
    for (const line of [...lines].sort((a, b) => byCodePoint(a.sku, b.sku))) await claimForHold(db, shopId, line.sku, line.quantity);
    await db.query("INSERT INTO holds (id, user_id, operator_id, store_id, status, created_at, expires_at) VALUES ($1, $2, $3, $4, 'active', $5, $6)",
      [id, user.id, user.operatorId, shopId, now, expires]);
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "23505") {
      const existing = await activeHold(pool, user.id);
      throw new ApiError(409, "hold_active", { hold_id: existing?.id ?? null });
    }
    throw error;
  }
  for (const line of lines) await db.query("INSERT INTO hold_lines (hold_id, sku, quantity) VALUES ($1, $2, $3)", [id, line.sku, line.quantity]);
  await db.query("UPDATE carts SET hold_id = $2 WHERE user_id = $1", [user.id, id]);
  return requireHoldRow(db, id);
}

function requireHoldRow(db: Pick<Db, "query">, id: string): Promise<HoldRow> {
  return required<HoldRow>(db, `SELECT ${HOLD_COLUMNS} FROM holds WHERE id = $1`, [id]);
}

export async function deleteHold(user: SessionUser, id: unknown, now: Date) {
  const found = await loadOwnHold(user, id, now);
  const released = found.status === "active" && await transaction(async (db) => {
    const done = await releaseHold(db, found.id, "deleted", now);
    await db.query("UPDATE carts SET hold_id = NULL WHERE user_id = $1 AND hold_id = $2", [user.id, found.id]);
    return done;
  });
  const current = await requireHoldRow(pool, found.id);
  if (!released) throw invalidTransition(current.status, "released");
  return holdObject(pool, current, now);
}

/** The active holds at one shop, oldest first. */
export async function activeHoldsOf(shopId: string): Promise<HoldRow[]> {
  return query<HoldRow>(pool, `SELECT ${HOLD_COLUMNS} FROM holds WHERE store_id = $1 AND status = 'active' ORDER BY created_at, id`, [shopId]);
}
