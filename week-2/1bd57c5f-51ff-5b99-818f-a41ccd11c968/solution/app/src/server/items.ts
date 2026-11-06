import { randomUUID } from "node:crypto";
import { CATALOGUE, FIELD_MESSAGES } from "../shared/catalogue";
import {
  BULK_ACTIONS,
  COST_FIELDS,
  EDITABLE_FIELDS,
  ITEM_ACTIONS,
  isCrew,
  isTrade,
  sameFieldValue,
  type BulkAction,
  type EditableField,
  type FieldChanges,
  type ItemAction,
  type ItemFields,
  type ItemStatus,
  type Trade,
} from "../shared/domain";
import { applyFieldPatch, type FieldPatch } from "../shared/fields";
import { isPlanFraction, roundPin } from "../shared/geometry";
import { decideAction, deletion, mayEditFields, roleMayAct, tradeChangeAllowed } from "../shared/lifecycle";
import { parseQuantity, parseUnitCost } from "../shared/money";
import { canSeeItem, isUuid, lockOpenJob, type JobAccess, type JobRow } from "./access";
import { maybeOne, one, rows, transaction, type Tx } from "./db";
import { ApiError, fail, invalid } from "./errors";
import { emit } from "./events";
import { queueEmail, signInLine } from "./mail";
import { fieldsOf, loadItemRecords, lockItemRow, patchedOf, type ItemRow, type RoomRow } from "./records";
import { deleteObject } from "./storage";

// The punch-item rules shared by the online routes, bulk requests and sync operations:
// creation, field edits, the per-field merge, lifecycle actions with blockers and the reopen
// cascade, blocked-by links, deletion and conflict resolution. Each checks in the API's
// precedence: not found, forbidden, closed, state conflicts, then validation.

const TITLE_MAX = 200;
const COST_NOTE_MAX = 1_000;
const REASON_MAX = 500;
const BLOCKERS_MAX = 10;
const BULK_MAX = 100;

/** A room id named in a body that is not a room of this job answers not found. */
function requireBodyRoom(raw: unknown, rooms: readonly RoomRow[]): void {
  if (typeof raw === "string" && !rooms.some((room) => room.id === raw)) fail("not_found");
}

/** A pin as sent, rounded to the plan's 0.0001 grid; anything else is not a pin. */
function readPin(raw: unknown): { x: number; y: number } | null | undefined {
  if (raw === null) return null;
  const pin = raw as { x?: unknown; y?: unknown } | undefined;
  if (typeof pin !== "object" || !isPlanFraction(pin.x) || !isPlanFraction(pin.y)) return undefined;
  return { x: roundPin(pin.x), y: roundPin(pin.y) };
}

/** Validates the editable fields present in a body into a patch, reporting every failing field. */
function parsePatch(raw: Record<string, unknown>): FieldPatch {
  const patch: FieldPatch = {};
  const errors: Record<string, string> = {};
  if ("title" in raw) {
    const title = typeof raw.title === "string" ? raw.title.trim() : "";
    if (title.length < 1 || title.length > TITLE_MAX) errors.title = `Enter a title of 1 to ${TITLE_MAX} characters.`;
    else patch.title = title;
  }
  if ("room_id" in raw) {
    if (typeof raw.room_id !== "string") errors.room_id = "Choose a room.";
    else patch.room_id = raw.room_id;
  }
  if ("trade" in raw) {
    if (raw.trade !== null && raw.trade !== "" && !isTrade(raw.trade)) errors.trade = "Choose one of the listed trades or no trade.";
    else patch.trade = raw.trade === "" ? null : raw.trade;
  }
  if ("cost_note" in raw) {
    if (raw.cost_note !== null && typeof raw.cost_note !== "string") errors.cost_note = "Enter the cost note as text.";
    else if (typeof raw.cost_note === "string" && raw.cost_note.length > COST_NOTE_MAX) {
      errors.cost_note = `Keep the cost note to ${COST_NOTE_MAX.toLocaleString("en-US")} characters.`;
    } else patch.cost_note = raw.cost_note === "" ? null : raw.cost_note;
  }
  if ("quantity" in raw) {
    const quantity = parseQuantity(raw.quantity === "" ? null : raw.quantity);
    if (quantity.ok) patch.quantity = quantity.value;
    else errors.quantity = "Enter a quantity from 0.001 to 9999.999 as text, with up to three decimals.";
  }
  if ("unit_cost" in raw) {
    const unitCost = parseUnitCost(raw.unit_cost === "" ? null : raw.unit_cost);
    if (unitCost.ok) patch.unit_cost = unitCost.value;
    else errors.unit_cost = "Enter a unit cost from 0.00 to 99999.99 as text, with up to two decimals.";
  }
  if ("pin" in raw) {
    const pin = readPin(raw.pin);
    if (pin === undefined) errors.pin = FIELD_MESSAGES.pin;
    else patch.pin = pin;
  }
  if (Object.keys(errors).length > 0) invalid(errors);
  return patch;
}

function roomName(rooms: readonly RoomRow[], id: string): string {
  return rooms.find((room) => room.id === id)?.name ?? "";
}

/** A change for the daily summary: creations, actions, re-filings and deletions (with the title at deletion). */
export async function recordChange(
  tx: Tx,
  jobId: string,
  itemId: string,
  kind: "created" | "changed" | "deleted" = "changed",
  deleted: { number: number; title: string } | null = null,
): Promise<void> {
  await tx.query(
    "INSERT INTO item_changes (job_id, item_id, kind, deleted_number, deleted_title) VALUES ($1, $2, $3, $4, $5)",
    [jobId, itemId, kind, deleted?.number ?? null, deleted?.title ?? null],
  );
}

/** The assignment-notice rule: one code-free email per active member of the newly given trade. */
async function queueAssignmentNotices(tx: Tx, job: JobRow, item: { number: number; title: string; roomName: string; trade: Trade }) {
  const recipients = await rows<{ email: string }>(
    tx,
    `SELECT p.email FROM job_members m JOIN people p ON p.id = m.person_id
     WHERE m.job_id = $1 AND m.role = 'trade' AND m.trade = $2 AND m.ended_at IS NULL ORDER BY m.position`,
    [job.id, item.trade],
  );
  for (const { email } of recipients) {
    await queueEmail(tx, {
      jobId: job.id,
      kind: "assignment",
      to: email,
      subject: `Snaglight: new item on ${job.name}`,
      body: [`Item ${item.number}: ${item.title}`, `Room: ${item.roomName}`, signInLine()].join("\n"),
    });
  }
}

/** Emits the committed items with the trade each had before this change. */
export async function emitItems(tx: Tx, jobId: string, previous: ReadonlyMap<string, Trade | null>): Promise<void> {
  const records = await loadItemRecords(tx, jobId, [...previous.keys()]);
  for (const item of records) emit(tx, jobId, { type: "item", item, previousTrade: previous.get(item.id) ?? null });
}

interface Applied {
  fields: ItemFields;
  pinStatus: ItemRow["pin_status"];
  changed: EditableField[];
}

/** Writes new field values, who set each changed field, the summary change and any assignment notice. */
async function writeFields(tx: Tx, access: JobAccess, item: ItemRow, outcome: Applied, rooms: readonly RoomRow[]): Promise<void> {
  const { fields, changed } = outcome;
  if (changed.length === 0 && outcome.pinStatus === item.pin_status) return;
  const setBy = Object.fromEntries(changed.map((field) => [field, access.person.id]));
  await tx.query(
    `UPDATE items SET title = $2, room_id = $3, trade = $4, cost_note = $5, quantity = $6, unit_cost = $7, pin_x = $8, pin_y = $9,
       pin_status = $10, set_by = set_by || $11::jsonb, updated_at = clock_timestamp() WHERE id = $1`,
    [item.id, fields.title, fields.room_id, fields.trade, fields.cost_note, fields.quantity, fields.unit_cost,
      fields.pin?.x ?? null, fields.pin?.y ?? null, outcome.pinStatus, JSON.stringify(setBy)],
  );
  if (changed.includes("room_id")) await recordChange(tx, access.job.id, item.id);
  if (changed.includes("trade") && fields.trade !== null) {
    await queueAssignmentNotices(tx, access.job, {
      number: item.number,
      title: fields.title,
      roomName: roomName(rooms, fields.room_id),
      trade: fields.trade,
    });
  }
}

function patched(item: ItemRow, patch: FieldPatch, rooms: readonly RoomRow[], tieBreak: string | null = null): Applied {
  const outcome = applyFieldPatch(patchedOf(item), patch, rooms, tieBreak);
  if (!outcome.ok) invalid({ pin: FIELD_MESSAGES.pin });
  return outcome;
}

/**
 * The item if the caller may see it, locked for the rest of the transaction. An item outside
 * the caller's scope is not visible (404) before the role is checked; on an endpoint the
 * caller's role may never use, every item in scope answers forbidden.
 */
export async function visibleItem(tx: Tx, access: JobAccess, itemId: unknown, roleMayUse = true): Promise<ItemRow> {
  if (!isUuid(itemId)) fail("not_found");
  const item = await lockItemRow(tx, access.job.id, itemId);
  if (!item || !canSeeItem(access, item.trade)) fail("not_found");
  if (!roleMayUse) fail("forbidden");
  return item;
}

/** A key a homeowner sends counts only when it is present, not null and not empty. */
function sends(raw: Record<string, unknown>, key: string): boolean {
  return raw[key] !== undefined && raw[key] !== null && raw[key] !== "";
}

export async function createItem(tx: Tx, access: JobAccess, raw: Record<string, unknown>, rooms: readonly RoomRow[]): Promise<string> {
  requireBodyRoom(raw.room_id, rooms);
  if (access.role === "trade") fail("forbidden");
  if (access.role === "homeowner" && ["trade", ...COST_FIELDS].some((key) => sends(raw, key))) fail("forbidden");
  await lockOpenJob(tx, access.job.id, "update");
  const errors: Record<string, string> = {};
  if (typeof raw.title !== "string" || raw.title.trim() === "") errors.title = `Enter a title of 1 to ${TITLE_MAX} characters.`;
  if (typeof raw.room_id !== "string") errors.room_id = "Choose a room.";
  let patch: FieldPatch = {};
  try {
    patch = parsePatch(Object.fromEntries(EDITABLE_FIELDS.filter((key) => key in raw).map((key) => [key, raw[key]])));
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    Object.assign(errors, error.fields);
  }
  if (Object.keys(errors).length > 0) invalid(errors);
  const start: ItemFields = { title: patch.title!, room_id: patch.room_id!, trade: null, cost_note: null, quantity: null, unit_cost: null, pin: null };
  const outcome = applyFieldPatch({ fields: start, pinStatus: "unpinned" }, patch, rooms);
  if (!outcome.ok) invalid({ pin: FIELD_MESSAGES.pin });
  const { fields } = outcome;
  const { number } = await one<{ number: number }>(
    tx,
    "UPDATE jobs SET next_item_number = next_item_number + 1 WHERE id = $1 RETURNING next_item_number - 1 AS number",
    [access.job.id],
  );
  const id = randomUUID();
  const setBy = Object.fromEntries(EDITABLE_FIELDS.map((field) => [field, access.person.id]));
  await tx.query(
    `INSERT INTO items (id, job_id, number, title, room_id, trade, pin_x, pin_y, pin_status, cost_note, quantity, unit_cost,
       created_by, created_by_role, set_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15::jsonb)`,
    [id, access.job.id, number, fields.title, fields.room_id, fields.trade, fields.pin?.x ?? null, fields.pin?.y ?? null,
      outcome.pinStatus, fields.cost_note, fields.quantity, fields.unit_cost, access.person.id, access.role, JSON.stringify(setBy)],
  );
  await recordChange(tx, access.job.id, id, "created");
  if (fields.trade !== null) {
    await queueAssignmentNotices(tx, access.job, { number, title: fields.title, roomName: roomName(rooms, fields.room_id), trade: fields.trade });
  }
  await emitItems(tx, access.job.id, new Map([[id, null]]));
  return id;
}

function requireMayEdit(access: JobAccess, item: ItemRow, fields: readonly EditableField[]): void {
  if (!mayEditFields(access.role, item.created_by === access.person.id, fields)) fail("forbidden");
}

/** A different trade on finished work is refused. */
function requireTradeChangeAllowed(item: ItemRow, trade: unknown): void {
  if (trade !== undefined && trade !== item.trade && !tradeChangeAllowed(item.status)) fail("invalid_transition");
}

/** An online edit: the new values replace the old ones and clear those fields' conflicts. */
export async function editItem(tx: Tx, access: JobAccess, itemId: string, raw: Record<string, unknown>, rooms: readonly RoomRow[]) {
  const item = await visibleItem(tx, access, itemId, access.role !== "trade");
  requireBodyRoom(raw.room_id, rooms);
  const keys = EDITABLE_FIELDS.filter((key) => key in raw);
  requireMayEdit(access, item, keys);
  await lockOpenJob(tx, access.job.id);
  requireTradeChangeAllowed(item, raw.trade === "" ? null : raw.trade);
  if (keys.length === 0) invalid({ body: "Send at least one of the item's editable fields." });
  const patch = parsePatch(raw);
  await writeFields(tx, access, item, patched(item, patch, rooms), rooms);
  await tx.query("DELETE FROM item_conflicts WHERE item_id = $1 AND field = ANY($2)", [item.id, keys]);
  await emitItems(tx, access.job.id, new Map([[item.id, item.trade]]));
}

/** The numbers of an item's blockers that are not verified, ascending, given each item's status. */
async function unverifiedBlockers(tx: Tx, itemId: string, statusOf?: ReadonlyMap<string, ItemStatus>): Promise<number[]> {
  const blockers = await rows<{ id: string; number: number; status: ItemStatus }>(
    tx,
    `SELECT i.id, i.number, i.status FROM item_blockers b JOIN items i ON i.id = b.blocker_id
     WHERE b.item_id = $1 ORDER BY i.number`,
    [itemId],
  );
  return blockers.filter((blocker) => (statusOf?.get(blocker.id) ?? blocker.status) !== "verified").map((blocker) => blocker.number);
}

async function hasCompletionPhoto(tx: Tx, itemId: string): Promise<boolean> {
  const found = await maybeOne(tx, "SELECT 1 FROM photos WHERE item_id = $1 AND kind = 'completion' LIMIT 1", [itemId]);
  return found !== null;
}

/**
 * The reopen cascade: every item that depends on the reopened one, directly or through any
 * chain, goes back to open when it was ready for check or verified. Answers their numbers.
 */
async function reopenDependents(tx: Tx, access: JobAccess, itemId: string, previous: Map<string, Trade | null>): Promise<number[]> {
  const dependents = await rows<{ id: string; number: number; trade: Trade | null }>(
    tx,
    `WITH RECURSIVE dependents(id) AS (
       SELECT item_id FROM item_blockers WHERE blocker_id = $1
       UNION
       SELECT b.item_id FROM item_blockers b JOIN dependents d ON b.blocker_id = d.id
     )
     UPDATE items i SET status = 'open', sent_back_reason = NULL, updated_at = clock_timestamp()
     FROM dependents d WHERE i.id = d.id AND i.id <> $1 AND i.status IN ('ready_for_check', 'verified')
     RETURNING i.id, i.number, i.trade`,
    [itemId],
  );
  for (const dependent of dependents) {
    await recordChange(tx, access.job.id, dependent.id);
    previous.set(dependent.id, dependent.trade);
  }
  return dependents.map((dependent) => dependent.number).sort((a, b) => a - b);
}

/** One lifecycle action. Answers the reopened dependents' numbers for a reopen. */
export async function actOnItem(tx: Tx, access: JobAccess, itemId: unknown, raw: Record<string, unknown>): Promise<number[]> {
  const item = await visibleItem(tx, access, itemId, access.role !== "homeowner");
  if (!(ITEM_ACTIONS as readonly unknown[]).includes(raw.action)) {
    if (access.role === "homeowner") fail("forbidden");
    await lockOpenJob(tx, access.job.id);
    invalid({ action: "Choose start, mark_done, verify, send_back or reopen." });
  }
  const action = raw.action as ItemAction;
  const facts = { hasCompletionPhoto: await hasCompletionPhoto(tx, item.id), unverifiedBlockers: await unverifiedBlockers(tx, item.id) };
  const decision = decideAction(action, item, access.role, facts);
  if (!decision.ok && decision.error === "forbidden") fail("forbidden");
  await lockOpenJob(tx, access.job.id);
  if (!decision.ok) {
    if (decision.error === "blocked") fail("blocked", { waiting_on: decision.waitingOn });
    fail(decision.error);
  }
  let reason: string | null = item.sent_back_reason;
  if (decision.needsReason) {
    reason = typeof raw.reason === "string" ? raw.reason.trim() : "";
    if (reason.length < 1 || reason.length > REASON_MAX) invalid({ reason: `Give a reason of 1 to ${REASON_MAX} characters.` });
  }
  if (decision.clearsSentBackReason) reason = null;
  await tx.query("UPDATE items SET status = $2, sent_back_reason = $3, updated_at = clock_timestamp() WHERE id = $1", [
    item.id,
    decision.to,
    reason,
  ]);
  await recordChange(tx, access.job.id, item.id);
  const previous = new Map<string, Trade | null>([[item.id, item.trade]]);
  const reopened = action === "reopen" ? await reopenDependents(tx, access, item.id, previous) : [];
  await emitItems(tx, access.job.id, previous);
  return reopened;
}

/** Replaces an item's blockers: at most ten, never a cycle, never an unverified one on finished work. */
export async function setBlockers(tx: Tx, access: JobAccess, itemId: string, raw: Record<string, unknown>): Promise<void> {
  // One blocker change at a time per job, so two changes can never close a cycle together. The
  // lock comes before any row lock: a new link's key check reads the blocker's row.
  await tx.query("SELECT pg_advisory_xact_lock(hashtext('blockers:' || $1))", [access.job.id]);
  const item = await visibleItem(tx, access, itemId, isCrew(access.role));
  const ids = Array.isArray(raw.item_ids) ? [...new Set(raw.item_ids)] : null;
  const blockers = ids
    ? await rows<{ id: string; number: number; status: ItemStatus }>(
        tx,
        "SELECT id, number, status FROM items WHERE job_id = $1 AND id = ANY($2::uuid[]) ORDER BY number",
        [access.job.id, ids.filter(isUuid)],
      )
    : [];
  if (ids && blockers.length !== ids.length) fail("not_found");
  await lockOpenJob(tx, access.job.id);
  const current = new Set((await rows<{ blocker_id: string }>(tx, "SELECT blocker_id FROM item_blockers WHERE item_id = $1", [item.id])).map((row) => row.blocker_id));
  const added = blockers.filter((blocker) => !current.has(blocker.id));
  if ((item.status === "ready_for_check" || item.status === "verified") && added.some((blocker) => blocker.status !== "verified")) {
    fail("blocked", { waiting_on: blockers.filter((blocker) => blocker.status !== "verified").map((blocker) => blocker.number) });
  }
  if (!ids) invalid({ item_ids: `Send a list of up to ${BLOCKERS_MAX} items.` });
  if (ids.length > BLOCKERS_MAX) invalid({ item_ids: `An item can wait on at most ${BLOCKERS_MAX} others.` });
  const edges = await rows<{ item_id: string; blocker_id: string }>(
    tx,
    "SELECT b.item_id, b.blocker_id FROM item_blockers b JOIN items i ON i.id = b.item_id WHERE i.job_id = $1 AND b.item_id <> $2",
    [access.job.id, item.id],
  );
  const waitsOn = (from: string, target: string, seen = new Set<string>()): boolean => {
    if (from === target) return true;
    if (seen.has(from)) return false;
    seen.add(from);
    return edges.some((edge) => edge.item_id === from && waitsOn(edge.blocker_id, target, seen));
  };
  if (blockers.some((blocker) => waitsOn(blocker.id, item.id))) invalid({ item_ids: FIELD_MESSAGES.cycle });
  await tx.query("DELETE FROM item_blockers WHERE item_id = $1", [item.id]);
  for (const blocker of blockers) await tx.query("INSERT INTO item_blockers (item_id, blocker_id) VALUES ($1, $2)", [item.id, blocker.id]);
  await tx.query("UPDATE items SET updated_at = clock_timestamp() WHERE id = $1", [item.id]);
  await emitItems(tx, access.job.id, new Map([[item.id, item.trade]]));
}

/** Refuses a deletion the role or the item's state does not allow, forbidden first (403 before 409). */
function requireMayDelete(access: JobAccess, item: ItemRow): void {
  const verdict = deletion(access.role, item.status, item.created_by === access.person.id);
  if (verdict !== "allowed") fail(verdict);
}

/**
 * Deletes an item: its photo objects first, then in one transaction its records, its links
 * and the item. When storage is unreachable nothing changes.
 */
export async function deleteItem(access: JobAccess, itemId: string): Promise<void> {
  const keys = await transaction(async (tx) => {
    const item = await visibleItem(tx, access, itemId, access.role !== "trade" && access.role !== "homeowner");
    if (deletion(access.role, item.status, item.created_by === access.person.id) === "forbidden") fail("forbidden");
    await lockOpenJob(tx, access.job.id);
    requireMayDelete(access, item);
    return (await rows<{ object_key: string }>(tx, "SELECT object_key FROM photos WHERE item_id = $1", [item.id])).map((row) => row.object_key);
  });
  for (const key of keys) await deleteObject(key);
  await transaction(async (tx) => {
    const item = await visibleItem(tx, access, itemId);
    await lockOpenJob(tx, access.job.id);
    requireMayDelete(access, item);
    // A photo stored between the two steps goes too, its object before its record.
    const late = await rows<{ object_key: string }>(tx, "SELECT object_key FROM photos WHERE item_id = $1 AND object_key <> ALL($2)", [
      item.id,
      keys,
    ]);
    for (const { object_key: key } of late) await deleteObject(key);
    const dependents = await rows<{ id: string; trade: Trade | null }>(
      tx,
      "SELECT i.id, i.trade FROM item_blockers b JOIN items i ON i.id = b.item_id WHERE b.blocker_id = $1",
      [item.id],
    );
    await tx.query("DELETE FROM items WHERE id = $1", [item.id]);
    await recordChange(tx, access.job.id, item.id, "deleted", { number: item.number, title: item.title });
    emit(tx, access.job.id, { type: "item_deleted", id: item.id, number: item.number, trade: item.trade });
    await emitItems(tx, access.job.id, new Map(dependents.map((dependent) => [dependent.id, dependent.trade])));
  });
}

export async function resolveConflict(tx: Tx, access: JobAccess, itemId: string, raw: Record<string, unknown>, rooms: readonly RoomRow[]) {
  const item = await visibleItem(tx, access, itemId, isCrew(access.role));
  await lockOpenJob(tx, access.job.id);
  const conflict = (EDITABLE_FIELDS as readonly unknown[]).includes(raw.field)
    ? await maybeOne<{ server_value: ItemFields[EditableField]; phone_value: ItemFields[EditableField] }>(
        tx,
        "SELECT server_value, phone_value FROM item_conflicts WHERE item_id = $1 AND field = $2",
        [item.id, raw.field],
      )
    : null;
  if (!conflict) fail("no_conflict");
  const field = raw.field as EditableField;
  const value = (field === "pin" ? readPin(raw.value) : raw.value) as ItemFields[EditableField];
  if (field === "trade") requireTradeChangeAllowed(item, value);
  if (!sameFieldValue(value, conflict.server_value) && !sameFieldValue(value, conflict.phone_value)) {
    invalid({ value: "Choose one of the two recorded values." });
  }
  await writeFields(tx, access, item, patched(item, { [field]: value }, rooms), rooms);
  await tx.query("DELETE FROM item_conflicts WHERE item_id = $1 AND field = $2", [item.id, field]);
  await emitItems(tx, access.job.id, new Map([[item.id, item.trade]]));
}

/**
 * A sync update: each changed field merges on its own. A field the server still holds at
 * `from` takes `to`; one already at `to` counts as applied; otherwise the server value is
 * kept and a conflict records both, except a pin, where the phone wins and the replaced pin
 * is recorded. `room_id` sent beside a pin only breaks a shared-edge tie. Answers whether a
 * conflict was recorded.
 */
export async function mergeChanges(tx: Tx, access: JobAccess, item: ItemRow, changes: FieldChanges, rooms: readonly RoomRow[]) {
  const keys = EDITABLE_FIELDS.filter((key) => key in changes);
  const malformed = keys.some((key) => {
    const change = changes[key] as unknown;
    return typeof change !== "object" || change === null || !("from" in change) || !("to" in change);
  });
  const to = Object.fromEntries(keys.map((key) => [key, changes[key]?.to]));
  requireBodyRoom(to.room_id, rooms);
  requireMayEdit(access, item, keys);
  await lockOpenJob(tx, access.job.id);
  if (keys.length === 0 || malformed) invalid({ changes: "Send each changed field as an object with from and to." });
  if (to.trade !== undefined) requireTradeChangeAllowed(item, to.trade === "" ? null : to.trade);
  const wanted = parsePatch(to);
  const from = parsePatchLoosely(Object.fromEntries(keys.map((key) => [key, changes[key]?.from])));
  const withPin = "pin" in changes;
  const current = fieldsOf(item);
  const apply: FieldPatch = {};
  const conflicted: EditableField[] = [];
  for (const field of keys) {
    if (field === "room_id" && withPin) continue;
    const target = wanted[field];
    if (sameFieldValue(current[field], from[field])) Object.assign(apply, { [field]: target });
    else if (sameFieldValue(current[field], target)) continue;
    else {
      conflicted.push(field);
      if (field === "pin") apply.pin = wanted.pin;
    }
  }
  const tieBreak = withPin && typeof wanted.room_id === "string" ? wanted.room_id : null;
  await writeFields(tx, access, item, patched(item, apply, rooms, tieBreak), rooms);
  for (const field of conflicted) {
    await tx.query(
      `INSERT INTO item_conflicts (item_id, field, server_value, server_by, phone_value, phone_by)
       VALUES ($1, $2, $3::jsonb, $4, $5::jsonb, $6)
       ON CONFLICT (item_id, field) DO UPDATE SET server_value = EXCLUDED.server_value, server_by = EXCLUDED.server_by,
         phone_value = EXCLUDED.phone_value, phone_by = EXCLUDED.phone_by`,
      [item.id, field, JSON.stringify(current[field]), item.set_by[field] ?? item.created_by, JSON.stringify(wanted[field] ?? null), access.person.id],
    );
  }
  await emitItems(tx, access.job.id, new Map([[item.id, item.trade]]));
  return conflicted.length > 0;
}

/** A phone's `from` values only need comparing: they are canonicalised where they read, never refused. */
function parsePatchLoosely(raw: Record<string, unknown>): FieldPatch {
  const out: FieldPatch = {};
  for (const [field, value] of Object.entries(raw) as [EditableField, unknown][]) {
    try {
      Object.assign(out, parsePatch({ [field]: value }));
    } catch {
      Object.assign(out, { [field]: value });
    }
  }
  return out;
}

// ---------- Bulk actions ----------

interface BulkFailure {
  number: number;
  error: string;
  message: string;
}

/**
 * All-or-nothing bulk start, mark done, verify or trade assignment. Items are judged in
 * ascending number against the state the earlier ones leave; any failure commits nothing.
 */
export async function bulkAct(tx: Tx, access: JobAccess, raw: Record<string, unknown>, rooms: readonly RoomRow[]): Promise<string[]> {
  const ids = Array.isArray(raw.item_ids) ? raw.item_ids : [];
  const found = await rows<ItemRow>(
    tx,
    `SELECT i.*, p.name AS creator_name FROM items i JOIN people p ON p.id = i.created_by
     WHERE i.job_id = $1 AND i.id = ANY($2::uuid[]) ORDER BY i.number FOR UPDATE OF i`,
    [access.job.id, ids.filter(isUuid)],
  );
  if (ids.some((id) => !found.some((item) => item.id === id && canSeeItem(access, item.trade)))) fail("not_found");
  const action = raw.action as BulkAction;
  const roleMay = action === "set_trade" ? isCrew(access.role) : (BULK_ACTIONS as readonly unknown[]).includes(action) && roleMayAct(action, access.role);
  if (access.role === "homeowner" || (access.role === "trade" && !roleMay)) fail("forbidden");
  await lockOpenJob(tx, access.job.id);
  const errors: Record<string, string> = {};
  if (!(BULK_ACTIONS as readonly unknown[]).includes(raw.action)) errors.action = "Choose start, mark_done, verify or set_trade.";
  if (action === "set_trade" && !(raw.trade === null || isTrade(raw.trade))) errors.trade = "Choose a trade, or null for crew.";
  if (!Array.isArray(raw.item_ids) || ids.length < 1 || ids.length > BULK_MAX || new Set(ids).size !== ids.length) {
    errors.item_ids = `Send 1 to ${BULK_MAX} different items.`;
  }
  if (Object.keys(errors).length > 0) invalid(errors);
  const status = new Map(found.map((item) => [item.id, item.status]));
  const failures: BulkFailure[] = [];
  const steps: { item: ItemRow; to: ItemStatus | null; clearsReason: boolean; trade: Trade | null | undefined }[] = [];
  for (const item of found) {
    const current = status.get(item.id)!;
    if (action === "set_trade") {
      const trade = raw.trade as Trade | null;
      if (trade !== item.trade && !tradeChangeAllowed(current)) {
        failures.push({ number: item.number, error: "invalid_transition", message: CATALOGUE.invalid_transition.message });
      } else steps.push({ item, to: null, clearsReason: false, trade });
      continue;
    }
    const facts = { hasCompletionPhoto: await hasCompletionPhoto(tx, item.id), unverifiedBlockers: await unverifiedBlockers(tx, item.id, status) };
    const decision = decideAction(action, { status: current, trade: item.trade }, access.role, facts);
    if (!decision.ok) {
      failures.push({ number: item.number, error: decision.error, message: CATALOGUE[decision.error].message });
      continue;
    }
    status.set(item.id, decision.to);
    steps.push({ item, to: decision.to, clearsReason: decision.clearsSentBackReason, trade: undefined });
  }
  if (failures.length > 0) fail("bulk_failed", { failures });
  const previous = new Map<string, Trade | null>();
  for (const { item, to, clearsReason, trade } of steps) {
    previous.set(item.id, item.trade);
    if (to !== null) {
      await tx.query(
        `UPDATE items SET status = $2, sent_back_reason = CASE WHEN $3 THEN NULL ELSE sent_back_reason END,
           updated_at = clock_timestamp() WHERE id = $1`,
        [item.id, to, clearsReason],
      );
      await recordChange(tx, access.job.id, item.id);
    } else if (trade !== undefined) {
      await writeFields(tx, access, item, patched(item, { trade }, rooms), rooms);
    }
  }
  await emitItems(tx, access.job.id, previous);
  return found.map((item) => item.id);
}
