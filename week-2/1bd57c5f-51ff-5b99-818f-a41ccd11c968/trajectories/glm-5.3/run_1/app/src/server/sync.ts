/** The offline sync: operations run in ascending client sequence, each is
 *  checked with the same rules as its online counterpart, fields merge by the
 *  published per-field policy and replays answer as duplicates. */

import { ApiError, Errors, FIELD_MESSAGES, errorBody } from "./errors.js";
import type { JobCtx } from "./context.js";
import { newId } from "./identity.js";
import { EventLog } from "./events.js";
import * as money from "./money.js";
import type { PoolClient } from "pg";
import type { Pt, TradeKey } from "../shared/types.js";
import { TRADES } from "../shared/types.js";
import { pointInOutline } from "./geometry.js";
import {
  actionPermitted, awaitingTrade, completionCount, completionPhotoRequired,
  itemById, itemExtras, nextItemNumber, recordChange, recordItemChange, roomForPin, roomsOf,
  roomNameOf, targetStatus, transitionAllowed, unverifiedBlockers, validatePin,
} from "./domain.js";
import { canSeeItem, projectItem, type DbItem } from "./projection.js";
import { applyEdit, charsForBody, visibleBodyAt, type CharState, type EditSpec, type RevisionMeta, type RevisionKind } from "./notes-model.js";
import { assignmentNotices } from "./notices.js";
import { solveAffineExact } from "./routes/jobs.js";

export type SyncOp =
  | { op_id: string; seq: number; type: "create_item"; client_item_id?: string; plan_revision?: number; fields: Record<string, unknown> }
  | { op_id: string; seq: number; type: "update_item"; item_id: string; plan_revision?: number; changes: Record<string, { from: unknown; to: unknown }> }
  | { op_id: string; seq: number; type: "item_action"; item_id: string; action: string; reason?: string }
  | { op_id: string; seq: number; type: "add_note"; item_id: string; client_note_id?: string; body: string; audience: string; parent_id?: string }
  | { op_id: string; seq: number; type: "edit_note"; item_id: string; note_id: string; base_rev: number; pos: number; delete: number; insert: string };

export type SyncResult = {
  op_id: string;
  seq: number;
  outcome: "applied" | "duplicate" | "conflict" | "rejected";
  item: Record<string, unknown> | null;
  error: Record<string, unknown> | null;
};

type ItemRef = { serverId: string | null; createdHere: boolean };

export type SyncOutcome = { results: SyncResult[]; synced: number; conflicts: number };

export async function runSync(ctx: JobCtx, ops: SyncOp[]): Promise<SyncOutcome> {
  const client = ctx.client;
  const results: SyncResult[] = [];
  const appliedItems = new Set<string>();
  const conflictedItems = new Set<string>();
  const clientItemIds = new Map<string, string>();
  const clientNoteIds = new Map<string, string>();
  const log = new EventLog(client);

  // Replays answer before any other check.
  const logged = new Map<string, { outcome: string; content: unknown }>();
  const logRows = await client.query<{ op_id: string; outcome: string; content: unknown }>(
    `SELECT op_id, outcome, content FROM op_log WHERE job_id = $1 AND op_id = ANY($2::text[])`,
    [ctx.jobId, ops.map((o) => o.op_id)],
  );
  for (const row of logRows.rows) logged.set(row.op_id, { outcome: row.outcome, content: row.content });

  const sorted = [...ops].sort((a, b) => a.seq - b.seq);

  for (const op of sorted) {
    const prior = logged.get(op.op_id);
    if (prior !== undefined) {
      const contentEqual = canonical(contentOf(op)) === canonical(prior.content);
      if (!contentEqual) {
        results.push(rejected(op, Errors.validation({ op_id: "That operation was already sent with different content." })));
        continue;
      }
      let replayItemId: string | null = itemForReplay(op);
      if (op.type === "create_item" && op.client_item_id !== undefined) {
        const mapped = await ctx.client.query<{ item_id: string }>(
          `SELECT item_id FROM client_item_map WHERE job_id = $1 AND client_id = $2`,
          [ctx.jobId, op.client_item_id],
        );
        replayItemId = mapped.rows[0]?.item_id ?? null;
      }
      const item = replayItemId === null ? null : await itemOrNull(ctx, replayItemId);
      results.push({
        op_id: op.op_id,
        seq: op.seq,
        outcome: "duplicate",
        item: item === null ? null : projectItem(ctx, ctx.jobId, item, await itemExtras(ctx, item)),
        error: null,
      });
      continue;
    }

    try {
      const applied = await applyOp(ctx, op, clientItemIds, clientNoteIds, appliedItems, conflictedItems, log);
      if (applied.itemId !== null) {
        const item = await itemOrNull(ctx, applied.itemId);
        results.push({
          op_id: op.op_id,
          seq: op.seq,
          outcome: applied.conflict ? "conflict" : "applied",
          item: item === null ? null : projectItem(ctx, ctx.jobId, item, await itemExtras(ctx, item)),
          error: null,
        });
      } else {
        results.push({ op_id: op.op_id, seq: op.seq, outcome: "applied", item: null, error: null });
      }
      if (applied.conflict) conflictedItems.add(applied.itemId ?? "");
      // synced counts distinct items with at least one applied-outcome operation.
      if (applied.itemId !== null && applied.countsAsApplied && !applied.conflict) appliedItems.add(applied.itemId);
    } catch (e) {
      if (e instanceof ApiError) {
        results.push(rejected(op, e));
      } else {
        throw e;
      }
    }
  }

  // The operation log keeps applied and conflict operations with their content.
  for (const result of results) {
    const op = sorted.find((o) => o.op_id === result.op_id)!;
    if (result.outcome === "applied" || result.outcome === "conflict") {
      await client.query(
        `INSERT INTO op_log (op_id, job_id, content, outcome) VALUES ($1, $2, $3, $4)
         ON CONFLICT (op_id, job_id) DO NOTHING`,
        [op.op_id, ctx.jobId, canonical(contentOf(op)), result.outcome],
      );
    }
  }
  if (results.some((r) => r.outcome === "applied" || r.outcome === "conflict")) {
    await log.emit(ctx.jobId, "counts", {});
    await log.emit(ctx.jobId, "costs", {});
  }

  return {
    results: results.sort((a, b) => a.seq - b.seq),
    synced: appliedItems.size,
    conflicts: conflictedItems.size,
  };
}

function rejected(op: SyncOp, e: ApiError): SyncResult {
  return { op_id: op.op_id, seq: op.seq, outcome: "rejected", item: null, error: errorBody(e) };
}

function contentOf(op: SyncOp): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...op };
  delete copy.op_id;
  delete copy.seq;
  return copy;
}

/** Canonical JSON with sorted keys, so jsonb's key reordering never turns a
 *  replay into a different-content rejection. */
function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
}

function itemForReplay(op: SyncOp): string | null {
  return op.type === "create_item" ? null : op.item_id;
}

async function itemOrNull(ctx: JobCtx, itemId: string): Promise<DbItem | null> {
  const item = await itemById(ctx.client, ctx.jobId, itemId);
  if (item === null || item.deleted_at !== null || !canSeeItem(ctx.membership, item)) return null;
  return item;
}

async function applyOp(
  ctx: JobCtx,
  op: SyncOp,
  clientItemIds: Map<string, string>,
  clientNoteIds: Map<string, string>,
  appliedItems: Set<string>,
  conflictedItems: Set<string>,
  log: EventLog,
): Promise<{ itemId: string | null; conflict: boolean; countsAsApplied: boolean }> {
  const client = ctx.client;
  if (ctx.jobStatus === "closed_out") throw Errors.jobClosed();
  const resolveItemId = async (raw: string): Promise<{ id: string | null }> => {
    if (clientItemIds.has(raw)) return { id: clientItemIds.get(raw)! };
    const item = await itemById(client, ctx.jobId, raw);
    if (item === null) return { id: null };
    return { id: item.id };
  };

  switch (op.type) {
    case "create_item": {
      if (ctx.membership.role === "trade") throw Errors.forbidden();
      const fields = op.fields ?? {};
      const fieldErrors: Record<string, string> = {};
      const title = typeof fields.title === "string" ? fields.title.trim() : "";
      if (title.length < 1 || title.length > 200) fieldErrors.title = "Give the item a title.";
      const rooms = await roomsOf(client, ctx.jobId);
      const room = typeof fields.room_id === "string" ? rooms.find((r) => r.id === fields.room_id) : undefined;
      if (room === undefined) fieldErrors.room_id = "Pick a room.";
      let pin: Pt | null = null;
      if (fields.pin !== undefined && fields.pin !== null) {
        const stamped = validatePin(fields.pin);
        if (stamped === null) fieldErrors.pin = FIELD_MESSAGES.pin;
        else pin = await mapPinThroughRevisions(ctx, stamped, op.plan_revision);
      }
      if (fields.pin !== undefined && fields.pin !== null && pin === null) fieldErrors.pin = FIELD_MESSAGES.pin;
      const forbiddenSent = ["trade", "cost_note", "quantity", "unit_cost"].some((k) => fields[k] !== undefined && fields[k] !== null && fields[k] !== "");
      if (ctx.membership.role === "homeowner" && forbiddenSent) throw Errors.forbidden();
      const trade = fields.trade === undefined ? null : fields.trade === null ? null : typeof fields.trade === "string" && TRADES.includes(fields.trade as TradeKey) ? (fields.trade as TradeKey) : undefined;
      if (trade === undefined) fieldErrors.trade = "Pick a trade.";
      const quantity = fields.quantity === undefined || fields.quantity === null ? null : money.parseQuantity(typeof fields.quantity === "string" ? fields.quantity : "");
      if (fields.quantity !== undefined && fields.quantity !== null && quantity === null) fieldErrors.quantity = "Quantity is a decimal like 2.500.";
      const unitCost = fields.unit_cost === undefined || fields.unit_cost === null ? null : money.parseUnitCost(typeof fields.unit_cost === "string" ? fields.unit_cost : "");
      if (fields.unit_cost !== undefined && fields.unit_cost !== null && unitCost === null) fieldErrors.unit_cost = "Unit cost is a decimal like 12.50.";
      const costNote = fields.cost_note === undefined || fields.cost_note === null ? null : typeof fields.cost_note === "string" ? fields.cost_note : undefined;
      if (costNote === undefined || (costNote !== null && costNote.length > 1000)) fieldErrors.cost_note = "The cost note is up to 1,000 characters.";
      if (op.plan_revision !== undefined && op.plan_revision > (await currentRevision(client, ctx.jobId))) {
        throw Errors.validation({ plan_revision: "That plan revision is not on the server." });
      }
      if (Object.keys(fieldErrors).length > 0) throw Errors.validation(fieldErrors);

      if (op.client_item_id !== undefined) {
        if (clientItemIds.has(op.client_item_id)) {
          throw Errors.validation({ client_item_id: "That item was already created." });
        }
        const existing = await client.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM client_item_map WHERE job_id = $1 AND client_id = $2`,
          [ctx.jobId, op.client_item_id],
        );
        if ((existing.rows[0]?.n ?? 0) > 0) throw Errors.validation({ client_item_id: "That item was already created." });
      }

      let roomId = room!.id;
      if (pin !== null) {
        const decided = roomForPin(pin, rooms, room!.id, null);
        if (decided === null) throw Errors.validation({ pin: FIELD_MESSAGES.pin });
        roomId = decided;
      }
      const id = newId("item");
      const number = await nextItemNumber(client, ctx.jobId);
      await client.query(
        `INSERT INTO items (id, job_id, number, title, room_id, trade, status, pin_x, pin_y, pin_status, cost_note, quantity, unit_cost, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, 'open', $7, $8, $9, $10, $11, $12, $13)`,
        [id, ctx.jobId, number, title, roomId, trade,
          pin === null ? null : pin.x.toFixed(4), pin === null ? null : pin.y.toFixed(4), pin === null ? "unpinned" : "placed",
          costNote,
          quantity === null ? null : money.fmtFixed(quantity, 3),
          unitCost === null ? null : money.fmtFixed(unitCost, 2),
          ctx.membership.id],
      );
      if (op.client_item_id !== undefined) {
        clientItemIds.set(op.client_item_id, id);
        await client.query(`INSERT INTO client_item_map (job_id, client_id, item_id) VALUES ($1, $2, $3)`, [ctx.jobId, op.client_item_id, id]);
      }
      await recordChange(client, ctx.jobId);
      await recordItemChange(client, ctx.jobId, { id, number, title }, "created");
      if (trade !== null && trade !== undefined) {
        const roomName = await roomNameOf(client, roomId);
        await assignmentNotices(client, ctx.jobId, { number, title, roomName }, trade);
      }
      await log.emit(ctx.jobId, "item", { item_id: id });
      return { itemId: id, conflict: false, countsAsApplied: true };
    }

    case "update_item": {
      const { id } = await resolveItemId(op.item_id);
      if (id === null) throw Errors.notFound();
      const item = await itemOrNull(ctx, id);
      if (item === null) throw Errors.notFound();
      const crew = ctx.membership.role === "owner" || ctx.membership.role === "lead";
      const ownCreated = item.created_by_person === ctx.membership.personId && item.created_by_role === "homeowner";
      if (!crew && !(ctx.membership.role === "homeowner" && ownCreated && Object.keys(op.changes).every((k) => k === "pin"))) {
        throw Errors.forbidden();
      }

      let anyConflict = false;
      const rooms = await roomsOf(client, ctx.jobId);
      const pending: Record<string, unknown> = {};
      const mappedFromPins = new Map<string, Pt | null>();
      const fieldErrors: Record<string, string> = {};

      for (const [field, change] of Object.entries(op.changes)) {
        if (!["title", "room_id", "trade", "cost_note", "quantity", "unit_cost", "pin"].includes(field)) {
          throw Errors.validation({ [field]: "That field does not exist." });
        }
        const to = change.to;
        if (field === "pin" && to !== null && to !== undefined) {
          const mapped = mapPinThroughRevisions(ctx, validatePin(to), op.plan_revision);
          if (mapped === null) throw Errors.validation({ pin: FIELD_MESSAGES.pin });
          pending.pin = mapped;
        } else {
          pending[field] = to;
        }
        if (field === "pin" && change.from !== null && change.from !== undefined) {
          mappedFromPins.set(field, await mapPinThroughRevisions(ctx, validatePin(change.from), op.plan_revision));
        }
        if (field === "quantity" && to !== null && to !== undefined && money.parseQuantity(String(to)) === null) {
          fieldErrors.quantity = "Quantity is a decimal like 2.500.";
        }
        if (field === "unit_cost" && to !== null && to !== undefined && money.parseUnitCost(String(to)) === null) {
          fieldErrors.unit_cost = "Unit cost is a decimal like 12.50.";
        }
      }
      if (op.plan_revision !== undefined && op.plan_revision > (await currentRevision(client, ctx.jobId))) {
        throw Errors.validation({ plan_revision: "That plan revision is not on the server." });
      }
      if (Object.keys(fieldErrors).length > 0) throw Errors.validation(fieldErrors);

      // Validate the whole operation before any field applies.
      if (pending.title !== undefined) {
        if (typeof pending.title !== "string" || pending.title.trim().length < 1 || pending.title.trim().length > 200) {
          throw Errors.validation({ title: "Give the item a title." });
        }
      }
      if (pending.cost_note !== undefined && pending.cost_note !== null) {
        if (typeof pending.cost_note !== "string" || pending.cost_note.length > 1000) {
          throw Errors.validation({ cost_note: "The cost note is up to 1,000 characters." });
        }
      }
      if (pending.room_id !== undefined && pending.room_id !== null) {
        if (!rooms.some((r) => r.id === pending.room_id)) throw Errors.validation({ room_id: "Pick a room." });
      }
      if (pending.trade !== undefined && pending.trade !== null) {
        if (typeof pending.trade !== "string" || !TRADES.includes(pending.trade as TradeKey)) {
          throw Errors.validation({ trade: "Pick a trade." });
        }
      }
      let newRoomId = item.room_id;
      let newPin = item.pin_x === null ? null : { x: Number(item.pin_x), y: Number(item.pin_y) };
      let newPinStatus = item.pin_status;
      if (pending.pin !== undefined) {
        if (pending.pin === null) {
          newPin = null;
          newPinStatus = "unpinned";
        } else {
          const decided = roomForPin(pending.pin as Pt, rooms, (pending.room_id as string) ?? null, item.room_id);
          if (decided === null) throw Errors.validation({ pin: FIELD_MESSAGES.pin });
          newRoomId = decided;
          newPin = pending.pin as Pt;
          newPinStatus = "placed";
        }
      } else if (pending.room_id !== undefined && pending.room_id !== null && pending.room_id !== item.room_id) {
        newRoomId = pending.room_id as string;
        if (newPin !== null) {
          const room = rooms.find((r) => r.id === newRoomId)!;
          if (!pointInOutline(newPin, room.outline)) {
            newPin = null;
            newPinStatus = "unpinned";
          }
        }
      }

      // Trade changes on finished work are refused.
      if (pending.trade !== undefined && pending.trade !== item.trade && (item.status === "ready_for_check" || item.status === "verified")) {
        throw Errors.invalidTransition();
      }

      const setValues: Record<string, unknown> = {};
      let tradeNotice: TradeKey | null = null;
      let anyApplied = false;
      for (const field of ["title", "cost_note", "quantity", "unit_cost", "trade"] as const) {
        if (pending[field] === undefined) continue;
        const serverValue = itemValue(item, field);
        const from = op.changes[field]?.from;
        const serverMatchesFrom = equalBy(field, serverValue, from);
        const serverEqualsTo = equalBy(field, serverValue, pending[field]);
        if (serverEqualsTo) {
          setValues[field] = serverValue;
          anyApplied = true;
          continue;
        }
        if (serverMatchesFrom) {
          setValues[field] = pending[field];
          anyApplied = true;
          if (field === "trade" && pending[field] !== null && pending[field] !== item.trade) {
            tradeNotice = pending[field] as TradeKey;
          }
        } else {
          anyConflict = true;
          await recordConflict(client, item.id, field, serverValue, pending[field], ctx.membership.id);
        }
      }
      if (pending.pin !== undefined) {
        const serverPin = item.pin_x === null ? null : { x: Number(item.pin_x), y: Number(item.pin_y) };
        const toPin = pending.pin === null ? null : (pending.pin as Pt);
        const fromPin = mappedFromPins.get("pin") ?? null;
        const serverEqualsTo = (serverPin === null && toPin === null) || (serverPin !== null && toPin !== null && serverPin.x === toPin.x && serverPin.y === toPin.y);
        if (serverEqualsTo) {
          anyApplied = true;
        } else {
          const serverMatchesFrom = (serverPin === null && fromPin === null) ||
            (serverPin !== null && fromPin !== null && serverPin.x === fromPin.x && serverPin.y === fromPin.y);
          anyApplied = true;
          if (!serverMatchesFrom) {
            anyConflict = true;
            await recordConflict(client, item.id, "pin", serverPin, toPin, ctx.membership.id);
          }
          await client.query(
            `UPDATE items SET pin_x = $2, pin_y = $3, pin_status = $4, room_id = $5, updated_at = now() WHERE id = $1`,
            [item.id, toPin === null ? null : toPin.x.toFixed(4), toPin === null ? null : toPin.y.toFixed(4), toPin === null ? "unpinned" : "placed", newRoomId],
          );
          await recordChange(client, ctx.jobId);
          await recordItemChange(client, ctx.jobId, item, "refiled");
        }
      } else if (pending.room_id !== undefined && pending.room_id !== null && pending.room_id !== item.room_id) {
        const serverValue = item.room_id;
        const serverMatchesFrom = serverValue === op.changes.room_id?.from;
        const serverEqualsTo = serverValue === pending.room_id;
        if (serverEqualsTo) {
          anyApplied = true;
        } else if (serverMatchesFrom) {
          anyApplied = true;
          await client.query(`UPDATE items SET room_id = $2, pin_x = $3, pin_y = $4, pin_status = $5, updated_at = now() WHERE id = $1`,
            [item.id, newRoomId, newPin === null ? null : newPin.x.toFixed(4), newPin === null ? null : newPin.y.toFixed(4), newPinStatus]);
          await recordChange(client, ctx.jobId);
          await recordItemChange(client, ctx.jobId, item, "refiled");
        } else {
          anyConflict = true;
          await recordConflict(client, item.id, "room_id", serverValue, pending.room_id, ctx.membership.id);
        }
      }

      const updates: string[] = [];
      const params: unknown[] = [item.id];
      let idx = 2;
      for (const field of ["title", "cost_note", "quantity", "unit_cost", "trade"] as const) {
        if (field in setValues) {
          const v = setValues[field];
          if (field === "quantity" || field === "unit_cost") {
            updates.push(`${field} = $${idx}`);
            params.push(v === null || v === undefined ? null : money.fmtFixed(money.parseDecimal(String(v))!, field === "quantity" ? 3 : 2));
            idx++;
          } else {
            updates.push(`${field} = $${idx}`);
            params.push(v === null || v === undefined ? null : v);
            idx++;
          }
          updates.push(`last_edited_by = $${idx}`);
          params.push(ctx.membership.id);
          idx++;
        }
      }
      if (updates.length > 0) {
        await client.query(`UPDATE items SET ${updates.join(", ")}, updated_at = now() WHERE id = $1`, params);
      }
      if (tradeNotice !== null) {
        const roomName = await roomNameOf(client, newRoomId);
        await assignmentNotices(client, ctx.jobId, { number: item.number, title: item.title, roomName }, tradeNotice);
      }
      await log.emit(ctx.jobId, "item", { item_id: item.id });
      return { itemId: item.id, conflict: anyConflict, countsAsApplied: anyApplied };
    }

    case "item_action": {
      const { id } = await resolveItemId(op.item_id);
      if (id === null) throw Errors.notFound();
      const item = await itemOrNull(ctx, id);
      if (item === null) throw Errors.notFound();
      const action = op.action;
      if (action !== "start" && action !== "mark_done" && action !== "verify" && action !== "send_back" && action !== "reopen") {
        throw Errors.validation({ action: "Pick an action." });
      }
      if (action === "send_back" && (typeof op.reason !== "string" || op.reason.trim().length < 1 || op.reason.trim().length > 500)) {
        throw Errors.validation({ reason: "Give a reason." });
      }
      if (!actionPermitted(ctx.membership.role, action, item, ctx.membership.trade)) throw Errors.forbidden();
      if (!transitionAllowed(action, item.status)) throw Errors.invalidTransition();
      if (action === "mark_done" || action === "verify") {
        const blockers = await unverifiedBlockers(client, item.id);
        if (blockers.length > 0) throw Errors.blocked(blockers);
      }
      if (awaitingTrade(action, item)) throw Errors.awaitingTrade();
      if (completionPhotoRequired(action, item, await completionCount(client, item.id))) throw Errors.completionPhotoRequired();
      await client.query(
        `UPDATE items SET status = $2, sent_back_reason = $3, updated_at = now() WHERE id = $1`,
        [item.id, targetStatus(action), action === "send_back" ? op.reason!.trim() : action === "mark_done" ? null : item.sent_back_reason],
      );
      await recordChange(client, ctx.jobId);
      await recordItemChange(client, ctx.jobId, item, "changed");
      if (action === "reopen") {
        await reopenDependents(client, ctx.jobId, item.id);
      }
      await log.emit(ctx.jobId, "item", { item_id: item.id });
      return { itemId: item.id, conflict: false, countsAsApplied: true };
    }

    case "add_note": {
      const { id } = await resolveItemId(op.item_id);
      if (id === null) throw Errors.notFound();
      const item = await itemOrNull(ctx, id);
      if (item === null) throw Errors.notFound();
      const body = typeof op.body === "string" ? op.body : null;
      if (body === null || [...body].length < 1 || [...body].length > 2000) throw Errors.validation({ body: "Notes are 1 to 2,000 characters." });
      const audience = op.audience === "crew" || op.audience === "everyone" ? op.audience : undefined;
      if (audience === undefined) throw Errors.validation({ audience: "Pick who can see this." });
      if (ctx.membership.role === "homeowner" && audience === "crew") throw Errors.forbidden();
      let parentId: string | null = null;
      if (op.parent_id !== undefined && op.parent_id !== null) {
        const parentRaw = clientNoteIds.get(op.parent_id) ?? op.parent_id;
        const parentRow = await client.query<{ id: string; parent_id: string | null; audience: "crew" | "everyone" }>(
          `SELECT id, parent_id, audience FROM notes WHERE job_id = $1 AND item_id = $2 AND id = $3`,
          [ctx.jobId, item.id, parentRaw],
        );
        const parent = parentRow.rows[0];
        if (parent === undefined) throw Errors.notFound();
        if (parent.parent_id !== null) throw Errors.validation({ parent_id: "Reply to a top-level note." });
        if (ctx.membership.role === "homeowner" && parent.audience === "crew") throw Errors.notFound();
        if (parent.audience === "crew" && audience === "everyone") throw Errors.validation({ audience: "Replies to crew notes stay crew-only." });
        parentId = parent.id;
      }
      if (op.client_note_id !== undefined) {
        if (clientNoteIds.has(op.client_note_id)) throw Errors.validation({ client_note_id: "That note was already created." });
        const existing = await client.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM client_note_map WHERE job_id = $1 AND client_id = $2`,
          [ctx.jobId, op.client_note_id],
        );
        if ((existing.rows[0]?.n ?? 0) > 0) throw Errors.validation({ client_note_id: "That note was already created." });
      }
      const noteId = newId("note");
      await client.query(
        `INSERT INTO notes (id, job_id, item_id, parent_id, body, audience, author_id, rev, chars)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 0, $8)`,
        [noteId, ctx.jobId, item.id, parentId, body, audience, ctx.membership.id, JSON.stringify(charsForBody(body))],
      );
      await client.query(
        `INSERT INTO note_revisions (note_id, rev, kind, author_id, edit_json, body) VALUES ($1, 0, 'create', $2, NULL, $3)`,
        [noteId, ctx.membership.id, body],
      );
      if (op.client_note_id !== undefined) {
        clientNoteIds.set(op.client_note_id, noteId);
        await client.query(`INSERT INTO client_note_map (job_id, client_id, note_id) VALUES ($1, $2, $3)`, [ctx.jobId, op.client_note_id, noteId]);
      }
      await log.emit(ctx.jobId, "note", { item_id: item.id, note_id: noteId });
      return { itemId: item.id, conflict: false, countsAsApplied: true };
    }

    case "edit_note": {
      const { id } = await resolveItemId(op.item_id);
      if (id === null) throw Errors.notFound();
      const item = await itemOrNull(ctx, id);
      if (item === null) throw Errors.notFound();
      const noteRaw = clientNoteIds.get(op.note_id) ?? op.note_id;
      const noteRow = await client.query<{ id: string; item_id: string; audience: "crew" | "everyone"; author_id: string; rev: number; chars: CharState[] }>(
        `SELECT id, item_id, audience, author_id, rev, chars FROM notes WHERE job_id = $1 AND item_id = $2 AND id = $3`,
        [ctx.jobId, item.id, noteRaw],
      );
      const note = noteRow.rows[0];
      if (note === undefined) throw Errors.notFound();
      if (note.audience === "crew") {
        const role = ctx.membership.role;
        const allowed = role === "owner" || role === "lead" || (role === "trade" && ctx.membership.trade !== null && item.trade === ctx.membership.trade);
        if (!allowed) throw Errors.notFound();
      }
      if (ctx.membership.role !== "owner" && ctx.membership.role !== "lead" && note.author_id !== ctx.membership.id) throw Errors.forbidden();

      const revRows = await client.query<{ rev: number; kind: RevisionKind; author_id: string; edit_json: unknown }>(
        `SELECT rev, kind, author_id, edit_json FROM note_revisions WHERE note_id = $1 ORDER BY rev`, [note.id],
      );
      const revisions: RevisionMeta[] = revRows.rows.map((r) => {
        const edit = r.kind === "undo" || r.kind === "redo" ? (r.edit_json as { target?: number } | null) : null;
        return { rev: r.rev, kind: r.kind, authorMemberId: r.author_id, target: edit?.target ?? null };
      });
      if (op.base_rev < 0 || op.base_rev > note.rev) throw Errors.validation({ base_rev: "Pick a revision to edit from." });
      if (op.pos < 0) throw Errors.validation({ pos: "Give a position." });
      const baseText = visibleBodyAt(note.chars, revisions, op.base_rev);
      if (op.pos + op.delete > [...baseText].length) throw Errors.validation({ pos: "That position is past the end of the text." });
      if (!(op.delete > 0) && op.insert.length === 0) throw Errors.validation({ delete: "Delete something or insert something." });
      const newRev = note.rev + 1;
      const spec: EditSpec = { pos: op.pos, delete: op.delete, insert: op.insert };
      const chars = applyEdit(note.chars, revisions, op.base_rev, spec, ctx.membership.id, newRev);
      const bodyText = visibleBodyAt(chars, [...revisions, { rev: newRev, kind: "edit", authorMemberId: ctx.membership.id, target: null }], newRev);
      if ([...bodyText].length < 1 || [...bodyText].length > 2000) throw Errors.validation({ insert: "Notes are 1 to 2,000 characters." });
      await client.query(`UPDATE notes SET chars = $2, body = $3, rev = $4 WHERE id = $1`, [note.id, JSON.stringify(chars), bodyText, newRev]);
      await client.query(
        `INSERT INTO note_revisions (note_id, rev, kind, author_id, edit_json, body) VALUES ($1, $2, 'edit', $3, $4, $5)`,
        [note.id, newRev, ctx.membership.id, JSON.stringify({ base: op.base_rev, ...spec }), bodyText],
      );
      await log.emit(ctx.jobId, "note", { item_id: item.id, note_id: note.id });
      return { itemId: item.id, conflict: false, countsAsApplied: true };
    }
  }
}

function itemValue(item: DbItem, field: "title" | "cost_note" | "quantity" | "unit_cost" | "trade"): string | null {
  switch (field) {
    case "title": return item.title;
    case "cost_note": return item.cost_note;
    case "quantity": return item.quantity;
    case "unit_cost": return item.unit_cost;
    case "trade": return item.trade;
  }
}

function equalBy(field: string, server: unknown, phone: unknown): boolean {
  if (field === "quantity" || field === "unit_cost") {
    if (server === null && (phone === null || phone === undefined)) return true;
    if (typeof server !== "string" || typeof phone !== "string") return false;
    const a = money.parseDecimal(server);
    const b = money.parseDecimal(phone);
    return a !== null && b !== null && a.int === b.int && a.scale === b.scale;
  }
  if (field === "trade") {
    return (server ?? null) === (phone ?? null);
  }
  return server === phone;
}

async function recordConflict(client: JobCtx["client"], itemId: string, field: string, serverValue: unknown, phoneValue: unknown, memberId: string): Promise<void> {
  const serverBy = await client.query<{ last_edited_by: string | null }>(
    `SELECT last_edited_by FROM items WHERE id = $1`, [itemId],
  );
  await client.query(
    `INSERT INTO conflicts (item_id, field, server_value, server_by, phone_value, phone_by)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (item_id, field) DO UPDATE SET server_value = $3, server_by = $4, phone_value = $5, phone_by = $6`,
    [itemId, field, JSON.stringify(serverValue ?? null), serverBy.rows[0]?.last_edited_by ?? memberId, JSON.stringify(phoneValue ?? null), memberId],
  );
}

async function currentRevision(client: PoolClient, jobId: string): Promise<number> {
  const res = await client.query<{ n: number }>(`SELECT max(revision) AS n FROM plan_revisions WHERE job_id = $1`, [jobId]);
  return res.rows[0]?.n ?? 0;
}

/** Maps a pin stamped with an older plan revision through every later
 *  revision's transform, rounding after each step. */
async function mapPinThroughRevisions(ctx: JobCtx, pin: Pt | null, stamped: number | undefined): Promise<Pt | null> {
  if (pin === null) return null;
  let point = pin;
  const revisions = await ctx.client.query<{ revision: number; reference_points: { old: Pt; new: Pt }[] | null }>(
    `SELECT revision, reference_points FROM plan_revisions WHERE job_id = $1 ORDER BY revision`,
    [ctx.jobId],
  );
  const current = revisions.rows.length === 0 ? 0 : revisions.rows[revisions.rows.length - 1]!.revision;
  if (stamped === undefined || stamped >= current) return point;
  for (const row of revisions.rows) {
    if (row.revision <= stamped) continue;
    if (row.reference_points === null) continue;
    const tr = solveAffineExact(row.reference_points);
    point = {
      x: Math.round((tr.a[0][0] * point.x + tr.a[0][1] * point.y + tr.t.x) * 10000) / 10000,
      y: Math.round((tr.a[1][0] * point.x + tr.a[1][1] * point.y + tr.t.y) * 10000) / 10000,
    };
  }
  return point;
}

async function reopenDependents(client: PoolClient, jobId: string, itemId: string): Promise<void> {
  const dependents = new Set<string>();
  let frontier = [itemId];
  while (frontier.length > 0) {
    const rows = await client.query<{ item_id: string }>(
      `SELECT item_id FROM item_links WHERE blocker_id = ANY($1::text[])`, [frontier],
    );
    frontier = [];
    for (const row of rows.rows) {
      if (!dependents.has(row.item_id)) {
        dependents.add(row.item_id);
        frontier.push(row.item_id);
      }
    }
  }
  if (dependents.size === 0) return;
  const rows = await client.query<{ id: string; number: number; title: string }>(
    `SELECT id, number, title FROM items WHERE job_id = $1 AND id = ANY($2::text[]) AND status IN ('ready_for_check', 'verified')`,
    [jobId, [...dependents]],
  );
  for (const row of rows.rows) {
    await client.query(`UPDATE items SET status = 'open', sent_back_reason = NULL, updated_at = now() WHERE id = $1`, [row.id]);
    await recordItemChange(client, jobId, row, "changed");
  }
}

