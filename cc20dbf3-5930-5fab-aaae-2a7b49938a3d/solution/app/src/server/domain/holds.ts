// Holds: placing a claim on the lowest free lane, and the requested → ready → collected / expired /
// cancelled moves.

import { randomUUID } from "node:crypto";
import type { HoldCreated, HoldStatus, User } from "../../shared/api.js";
import { noSuchCopy } from "../../shared/copy.js";
import { holdDateErrors } from "../../shared/windows.js";
import { config } from "../config.js";
import { lockKey, pool, withTransaction } from "../db.js";
import { ApiError, FieldErrors } from "../http/errors.js";
import { assertNotPaused, assertUnderLimit } from "./borrowing.js";
import { library, today } from "./library.js";
import { queueLapseNotice, queueReadyNotice } from "./notices.js";
import { activeSpans, freeUnits, unitsOf } from "./occupancy.js";
import { holdJson, type HoldRow, readHold } from "./records.js";

const HOLD_MOVES = {
  ready: ["requested"],
  cancel: ["requested", "ready"],
  collect: ["ready"],
} as const satisfies Record<string, readonly HoldStatus[]>;

type HoldMove = keyof typeof HOLD_MOVES;

/** The one decision on whether a hold may make a move; checkout of a lapsed hold is `hold_expired`. */
export function assertHoldMove(move: HoldMove, status: HoldStatus): void {
  if (move === "collect" && status === "expired") throw ApiError.of("hold_expired");
  if (!(HOLD_MOVES[move] as readonly HoldStatus[]).includes(status)) throw ApiError.invalidTransition("hold", status);
}

interface HoldRequest {
  itemId: string;
  start: string;
  end: string;
}

export function asObject(json: unknown): Record<string, unknown> {
  return typeof json === "object" && json !== null && !Array.isArray(json) ? (json as Record<string, unknown>) : {};
}

export async function parseHoldRequest(json: unknown, now: Date): Promise<HoldRequest> {
  const body = asObject(json);
  const fields = new FieldErrors();
  const itemId = typeof body.item_id === "string" ? body.item_id : "";
  const known = await pool.query("SELECT 1 FROM item WHERE id = $1", [itemId]);
  if (!known.rowCount) fields.add("item_id", noSuchCopy("item"));
  for (const [field, copy] of Object.entries(holdDateErrors(library().calendar, today(now), body.start_date, body.end_date))) {
    fields.add(field, copy);
  }
  fields.throwIfAny();
  return { itemId, start: body.start_date as string, end: body.end_date as string };
}

export async function placeHold(member: User, request: HoldRequest, now: Date): Promise<HoldCreated> {
  return withTransaction(async (db) => {
    await lockKey(db, "member", member.id);
    await lockKey(db, "item", request.itemId);
    await assertNotPaused(db, now, member.id);
    await assertUnderLimit(db, now, member.id);
    const units = await unitsOf(db, [request.itemId]);
    const free = freeUnits(units, await activeSpans(db, now, [request.itemId]), request.start, request.end);
    const unit = free[0];
    if (!unit) throw ApiError.of("no_unit_free");
    const id = randomUUID();
    await db.query(
      `INSERT INTO hold (id, member_id, item_id, unit_id, status, start_date, end_date, created_at)
       VALUES ($1, $2, $3, $4, 'requested', $5, $6, $7)`,
      [id, member.id, request.itemId, unit.id, request.start, request.end, now],
    );
    const row = await readHold(db, now, id);
    if (!row) throw new Error("hold vanished inside its own transaction");
    return { hold: holdJson(row), units_free: free.length - 1, unit_count: units.length };
  });
}

const target = (row: HoldRow) => ({ memberId: row.member_id, itemName: row.item_name, unitLabel: row.unit_label });

export async function markReady(holdId: string, now: Date): Promise<HoldRow> {
  return withTransaction(async (db) => {
    const row = await readHold(db, now, holdId, true);
    if (!row) throw ApiError.of("not_found");
    assertHoldMove("ready", row.status);
    const deadline = new Date(now.getTime() + config.pickupWindowSeconds * 1000);
    await db.query("UPDATE hold SET status = 'ready', ready_at = $2, pickup_deadline = $3 WHERE id = $1", [holdId, now, deadline]);
    await queueReadyNotice(db, target(row), deadline, now);
    return { ...row, status: "ready", ready_at: now, pickup_deadline: deadline };
  });
}

export async function cancelHold(holdId: string, now: Date): Promise<HoldRow> {
  return withTransaction(async (db) => {
    const row = await readHold(db, now, holdId, true);
    if (!row) throw ApiError.of("not_found");
    assertHoldMove("cancel", row.status);
    await db.query("UPDATE hold SET status = 'cancelled' WHERE id = $1", [holdId]);
    return { ...row, status: "cancelled" };
  });
}

/** Background sweep: ready holds whose pickup deadline has passed become expired, with one lapse email each. */
export async function expireLapsedHolds(now: Date): Promise<void> {
  await withTransaction(async (db) => {
    const lapsed = await db.query<{ id: string }>(
      "UPDATE hold SET status = 'expired' WHERE status = 'ready' AND pickup_deadline <= $1 RETURNING id",
      [now],
    );
    for (const { id } of lapsed.rows) {
      const row = await readHold(db, now, id);
      if (row?.pickup_deadline) await queueLapseNotice(db, target(row), row.pickup_deadline, now);
    }
  });
}
