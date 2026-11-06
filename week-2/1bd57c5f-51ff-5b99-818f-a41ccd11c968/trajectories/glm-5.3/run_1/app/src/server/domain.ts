/** Domain queries and rules shared by every route: item lookup with visibility,
 *  derived counts, item numbering, the pin rules, the lifecycle table, the
 *  per-field merge policy and the costs rollup. Each rule lives here once. */

import type { PoolClient } from "pg";
import { Errors, FIELD_MESSAGES } from "./errors.js";
import type { DbItem, DbPhoto, DbNote, DbConflict, ItemExtras } from "./projection.js";
import { canSeeItem, canSeeNote, projectItem } from "./projection.js";
import type { JobCtx, Membership } from "./context.js";
import type { Outline, Pt, TradeKey } from "../shared/types.js";
import { pointInOutline, roundPin } from "./geometry.js";
import * as money from "./money.js";
import type { Decimal } from "./money.js";
import { newId } from "./identity.js";
import { utcIso } from "./times.js";

export async function roomsOf(client: PoolClient, jobId: string): Promise<{ id: string; name: string; outline: Outline; sort_order: number }[]> {
  const res = await client.query<{ id: string; name: string; outline: Outline; sort_order: number }>(
    `SELECT id, name, outline, sort_order FROM rooms WHERE job_id = $1 ORDER BY sort_order`,
    [jobId],
  );
  return res.rows.map((r) => ({ ...r, outline: r.outline as unknown as Outline }));
}

/** The room a pin belongs to, by the published shared-edge order: the room_id
 *  given with the request when it contains the pin, else the item's current
 *  room when it contains the pin, else the earliest-created room containing it. */
export function roomForPin(
  pin: Pt,
  rooms: { id: string; outline: Outline }[],
  requestedRoomId: string | null,
  currentRoomId: string | null,
): string | null {
  const containing = rooms.filter((r) => pointInOutline(pin, r.outline));
  if (containing.length === 0) return null;
  if (requestedRoomId !== null) {
    const req = containing.find((r) => r.id === requestedRoomId);
    if (req !== undefined) return req.id;
  }
  if (currentRoomId !== null) {
    const cur = containing.find((r) => r.id === currentRoomId);
    if (cur !== undefined) return cur.id;
  }
  return containing[0].id;
}

export async function itemById(client: PoolClient, jobId: string, itemId: string): Promise<DbItem | null> {
  const res = await client.query(
    `SELECT i.id, i.number, i.title, i.room_id, i.trade, i.status, i.pin_x::text AS pin_x, i.pin_y::text AS pin_y,
            i.pin_status, i.cost_note, i.quantity::text AS quantity, i.unit_cost::text AS unit_cost,
            i.sent_back_reason, p.name AS created_by_name, m.role AS created_by_role, m.person_id AS created_by_person,
            i.deleted_at, i.updated_at
     FROM items i
     JOIN job_members m ON m.id = i.created_by
     JOIN people p ON p.id = m.person_id
     WHERE i.job_id = $1 AND i.id = $2`,
    [jobId, itemId],
  );
  const r = res.rows[0];
  if (r === undefined) return null;
  return r as unknown as DbItem;
}

export async function visibleItem(ctx: JobCtx, itemId: string): Promise<DbItem> {
  const item = await itemById(ctx.client, ctx.jobId, itemId);
  if (item === null || item.deleted_at !== null || !canSeeItem(ctx.membership, item)) throw Errors.notFound();
  return item;
}

export async function blockedByNumbers(client: PoolClient, itemId: string): Promise<number[]> {
  const res = await client.query<{ number: number }>(
    `SELECT b.number FROM item_links l JOIN items b ON b.id = l.blocker_id
     WHERE l.item_id = $1 ORDER BY b.number`,
    [itemId],
  );
  return res.rows.map((r) => r.number);
}

export async function photosOf(client: PoolClient, jobId: string, itemId: string): Promise<DbPhoto[]> {
  const res = await client.query(
    `SELECT ph.id, ph.kind, ph.content_type, ph.bytes, p.name AS uploaded_by_name, m.role AS uploaded_by_role, ph.created_at
     FROM item_photos ph JOIN job_members m ON m.id = ph.uploaded_by JOIN people p ON p.id = m.person_id
     WHERE ph.item_id = $1 ORDER BY ph.created_at, ph.id`,
    [itemId],
  );
  void jobId;
  return res.rows as unknown as DbPhoto[];
}

export async function completionCount(client: PoolClient, itemId: string): Promise<number> {
  const res = await client.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM item_photos WHERE item_id = $1 AND kind = 'completion'`,
    [itemId],
  );
  return res.rows[0]?.n ?? 0;
}

export async function notesOf(client: PoolClient, jobId: string, itemId: string, membership: Membership, itemTrade: TradeKey | null): Promise<DbNote[]> {
  const res = await client.query(
    `SELECT n.id, n.item_id, n.parent_id, n.body, n.audience, p.name AS author_name, m.role AS author_role, n.rev, n.created_at
     FROM notes n JOIN job_members m ON m.id = n.author_id JOIN people p ON p.id = m.person_id
     WHERE n.item_id = $1 AND n.parent_id IS NULL ORDER BY n.created_at, n.id`,
    [itemId],
  );
  const replyRes = await client.query(
    `SELECT n.id, n.item_id, n.parent_id, n.body, n.audience, p.name AS author_name, m.role AS author_role, n.rev, n.created_at
     FROM notes n JOIN job_members m ON m.id = n.author_id JOIN people p ON p.id = m.person_id
     WHERE n.item_id = $1 AND n.parent_id IS NOT NULL ORDER BY n.created_at, n.id`,
    [itemId],
  );
  const tops = res.rows as unknown as DbNote[];
  const replies = replyRes.rows as unknown as DbNote[];
  const out: DbNote[] = [];
  for (const top of tops) {
    if (!canSeeNote(membership, { audience: top.audience, item_trade: itemTrade })) continue;
    out.push(top);
    for (const reply of replies) {
      if (reply.parent_id === top.id && canSeeNote(membership, { audience: reply.audience, item_trade: itemTrade })) {
        out.push(reply);
      }
    }
  }
  return out;
}

export async function conflictsOf(client: PoolClient, itemId: string): Promise<DbConflict[]> {
  const res = await client.query(
    `SELECT c.field, c.server_value, bs.name AS server_by, c.phone_value, bp.name AS phone_by
     FROM conflicts c
     JOIN job_members ms ON ms.id = c.server_by JOIN people bs ON bs.id = ms.person_id
     JOIN job_members mp ON mp.id = c.phone_by JOIN people bp ON bp.id = mp.person_id
     WHERE c.item_id = $1`,
    [itemId],
  );
  return res.rows as unknown as DbConflict[];
}

export async function itemExtras(ctx: JobCtx, item: DbItem): Promise<ItemExtras> {
  // Sequential on one client: pg clients run one query at a time.
  const photos = await photosOf(ctx.client, ctx.jobId, item.id);
  const notes = await notesOf(ctx.client, ctx.jobId, item.id, ctx.membership, item.trade);
  const conflicts = isCrewRole(ctx.membership.role) ? await conflictsOf(ctx.client, item.id) : ([] as DbConflict[]);
  const blockedBy = await blockedByNumbers(ctx.client, item.id);
  const lineTotal = money.lineTotal(
    item.quantity === null ? null : money.parseDecimal(item.quantity),
    item.unit_cost === null ? null : money.parseDecimal(item.unit_cost),
  );
  return {
    photos,
    notes,
    conflicts,
    blockedBy,
    lineTotal: money.fmtFixed(lineTotal, 2),
  };
}

export function isCrewRole(role: string): boolean {
  return role === "owner" || role === "lead";
}

/** Full projected item payload, in the caller's role and scope. */
export async function projectFullItem(ctx: JobCtx, itemId: string): Promise<Record<string, unknown>> {
  const item = await visibleItem(ctx, itemId);
  const extras = await itemExtras(ctx, item);
  return projectItem(ctx, ctx.jobId, item, extras);
}

/** One calculation for room counts and job progress, within a caller's scope. */
export async function derivedCounts(
  client: PoolClient,
  jobId: string,
  membership: Membership,
): Promise<{ progress: { verified: number; total: number; percent: number }; rooms: { id: string; counts: { verified: number; total: number } }[] }> {
  const res = await client.query<{ room_id: string; verified: number; total: number }>(
    `SELECT i.room_id,
            count(*) FILTER (WHERE i.status = 'verified')::int AS verified,
            count(*)::int AS total
     FROM items i
     WHERE i.job_id = $1 AND i.deleted_at IS NULL
       AND CASE WHEN $2 = 'trade' THEN i.trade = $3 ELSE true END
     GROUP BY i.room_id`,
    [jobId, membership.role, membership.trade],
  );
  const roomCounts = new Map(res.rows.map((r) => [r.room_id, r]));
  const rooms = await roomsOf(client, jobId);
  const out: { id: string; counts: { verified: number; total: number } }[] = [];
  let verified = 0;
  let total = 0;
  for (const room of rooms) {
    const c = roomCounts.get(room.id) ?? { room_id: room.id, verified: 0, total: 0 };
    out.push({ id: room.id, counts: { verified: c.verified, total: c.total } });
    verified += c.verified;
    total += c.total;
  }
  return {
    progress: { verified, total, percent: total === 0 ? 0 : Math.floor((verified / total) * 100) },
    rooms: out,
  };
}

/** The next consecutive job-wide item number; deleted numbers are never reused. */
export async function nextItemNumber(client: PoolClient, jobId: string): Promise<number> {
  const res = await client.query<{ n: number }>(
    `UPDATE jobs SET next_item_number = next_item_number + 1 WHERE id = $1 RETURNING next_item_number - 1 AS n`,
    [jobId],
  );
  return res.rows[0]?.n ?? 1;
}

export async function recordChange(client: PoolClient, jobId: string): Promise<void> {
  await client.query(`UPDATE jobs SET last_change_at = now() WHERE id = $1`, [jobId]);
}

export async function costsAt(
  client: PoolClient,
  jobId: string,
  asOf: Date,
): Promise<Record<string, unknown>> {
  const rooms = await roomsOf(client, jobId);
  const itemsRes = await client.query<{ room_id: string; trade: TradeKey | null; quantity: string | null; unit_cost: string | null }>(
    `SELECT room_id, trade, quantity::text AS quantity, unit_cost::text AS unit_cost FROM items
     WHERE job_id = $1 AND deleted_at IS NULL`,
    [jobId],
  );
  const byRoom = new Map(rooms.map((r) => [r.id, { name: r.name, subtotal: money.ZERO_CENTS }]));
  const byTrade = new Map<string | null, Decimal>([
    ["electrical", money.ZERO_CENTS], ["plumbing", money.ZERO_CENTS], ["tile", money.ZERO_CENTS],
    ["paint", money.ZERO_CENTS], ["carpentry", money.ZERO_CENTS], ["hvac", money.ZERO_CENTS],
    ["flooring", money.ZERO_CENTS], [null, money.ZERO_CENTS],
  ]);
  let itemsSubtotal = money.ZERO_CENTS;
  for (const item of itemsRes.rows) {
    const q = item.quantity === null ? null : money.parseDecimal(item.quantity);
    const u = item.unit_cost === null ? null : money.parseDecimal(item.unit_cost);
    const lt = money.lineTotal(q, u);
    itemsSubtotal = money.add(itemsSubtotal, lt);
    const room = byRoom.get(item.room_id);
    if (room !== undefined) room.subtotal = money.add(room.subtotal, lt);
    const trade = byTrade.get(item.trade) ?? byTrade.get(null);
    if (trade !== undefined) byTrade.set(item.trade, money.add(trade, lt));
  }
  const coRes = await client.query<{ amount: string }>(
    `SELECT amount::text AS amount FROM change_orders WHERE job_id = $1 AND status = 'approved' AND approved_at <= $2`,
    [jobId, asOf.toISOString()],
  );
  let changeOrdersTotal = money.ZERO_CENTS;
  for (const co of coRes.rows) changeOrdersTotal = money.add(changeOrdersTotal, money.parseDecimal(co.amount) ?? money.ZERO_CENTS);
  const pctRes = await client.query<{ percent: string }>(
    `SELECT percent::text AS percent FROM contingency_settings WHERE job_id = $1 AND effective_at <= $2
     ORDER BY effective_at DESC LIMIT 1`,
    [jobId, asOf.toISOString()],
  );
  const percent = pctRes.rows[0] !== undefined ? money.parseDecimal(pctRes.rows[0].percent) ?? money.ZERO_PERCENT : money.ZERO_PERCENT;
  const base = money.add(itemsSubtotal, changeOrdersTotal);
  const contingency = money.contingencyAmount(base, percent);
  const total = money.add(base, contingency);
  return {
    as_of: utcIso(asOf),
    by_room: rooms.map((r) => ({ room_id: r.id, name: r.name, subtotal: money.fmtFixed(byRoom.get(r.id)?.subtotal ?? money.ZERO_CENTS, 2) })),
    by_trade: [...byTrade.entries()].map(([trade, subtotal]) => ({ trade, subtotal: money.fmtFixed(subtotal, 2) })),
    items_subtotal: money.fmtFixed(itemsSubtotal, 2),
    change_orders_total: money.fmtFixed(changeOrdersTotal, 2),
    contingency_percent: money.fmtFixed(percent, 2),
    contingency: money.fmtFixed(contingency, 2),
    total: money.fmtFixed(total, 2),
  };
}

/** The item lifecycle table, decided once. */
export type ItemAction = "start" | "mark_done" | "verify" | "send_back" | "reopen";

export function transitionAllowed(
  action: ItemAction,
  status: DbItem["status"],
): boolean {
  switch (action) {
    case "start":
      return status === "open";
    case "mark_done":
      return status === "in_progress";
    case "verify":
      return status === "open" || status === "in_progress" || status === "ready_for_check";
    case "send_back":
      return status === "ready_for_check";
    case "reopen":
      return status === "verified";
  }
}

/** A trade's item must reach ready for check before it can be verified. */
export function awaitingTrade(action: ItemAction, item: DbItem): boolean {
  return action === "verify" && item.trade !== null && item.status !== "ready_for_check";
}

export function completionPhotoRequired(action: ItemAction, item: DbItem, completions: number): boolean {
  return action === "mark_done" && item.trade !== null && completions === 0;
}

export function targetStatus(action: ItemAction): DbItem["status"] {
  switch (action) {
    case "start":
      return "in_progress";
    case "mark_done":
      return "ready_for_check";
    case "verify":
      return "verified";
    case "send_back":
      return "in_progress";
    case "reopen":
      return "open";
  }
}

/** Which role may perform an item action. */
export function actionPermitted(role: string, action: ItemAction, item: DbItem, membershipTrade: TradeKey | null): boolean {
  if (role === "homeowner") return false;
  if (role === "owner" || role === "lead") return action !== "reopen" || role === "owner";
  if (role === "trade") {
    if (membershipTrade === null || item.trade !== membershipTrade) return false;
    return action === "start" || action === "mark_done";
  }
  return false;
}

/** Unverified blockers of an item, as numbers ascending. */
export async function unverifiedBlockers(client: PoolClient, itemId: string): Promise<number[]> {
  const res = await client.query<{ number: number }>(
    `SELECT b.number FROM item_links l JOIN items b ON b.id = l.blocker_id
     WHERE l.item_id = $1 AND b.status <> 'verified' ORDER BY b.number`,
    [itemId],
  );
  return res.rows.map((r) => r.number);
}

export function validatePin(pin: unknown): Pt | null {
  if (typeof pin !== "object" || pin === null) return null;
  const o = pin as { x?: unknown; y?: unknown };
  if (typeof o.x !== "number" || typeof o.y !== "number") return null;
  if (!Number.isFinite(o.x) || !Number.isFinite(o.y)) return null;
  return { x: roundPin(o.x), y: roundPin(o.y) };
}

export function pinMessage(): string {
  return FIELD_MESSAGES.pin;
}

export async function membersOfTrade(client: PoolClient, jobId: string, trade: TradeKey): Promise<{ id: string; email: string }[]> {
  const res = await client.query<{ id: string; email: string }>(
    `SELECT m.id, p.email FROM job_members m JOIN people p ON p.id = m.person_id
     WHERE m.job_id = $1 AND m.role = 'trade' AND m.trade = $2 AND m.ended_at IS NULL`,
    [jobId, trade],
  );
  return res.rows;
}

export function newPhotoId(): string {
  return newId("photo");
}

export type ItemChangeKind = "created" | "changed" | "refiled" | "deleted";

/** Records one summary change: creations, actions (cascades included),
 *  re-filings and deletions. Seeded records are never passed here. */
export async function recordItemChange(client: PoolClient, jobId: string, item: { id: string; number: number; title: string }, kind: ItemChangeKind): Promise<void> {
  await client.query(
    `INSERT INTO item_changes (job_id, item_id, number, title, kind, at) VALUES ($1, $2, $3, $4, $5, now())`,
    [jobId, item.id, item.number, item.title, kind],
  );
}

export async function roomNameOf(client: PoolClient, roomId: string): Promise<string> {
  const res = await client.query<{ name: string }>(`SELECT name FROM rooms WHERE id = $1`, [roomId]);
  return res.rows[0]?.name ?? "";
}
