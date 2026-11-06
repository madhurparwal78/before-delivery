import type { FieldChanges, SyncResponse, SyncResult } from "../shared/domain";
import { affineFromJson, applyAffine, type Point } from "../shared/geometry";
import { isUuid, type JobAccess } from "./access";
import { maybeOne, pool, rows, transaction, type Tx } from "./db";
import { ApiError, fail, invalid } from "./errors";
import { actOnItem, createItem, mergeChanges, visibleItem } from "./items";
import { addNote, editNote } from "./notes";
import { projectItem } from "./projection";
import { loadItems, loadRooms } from "./records";

// The offline operation log. Operations run in ascending client sequence, each in its own
// transaction with its log record, under the same rules as their online counterparts. An
// op_id already logged answers as a replay before any other check and changes nothing.

const OPS_MAX = 200;
const SEQ_MAX = 2_147_483_647;
const OP_TYPES = ["create_item", "update_item", "item_action", "add_note", "edit_note"] as const;

type Outcome = "applied" | "conflict";
type RawOp = Record<string, unknown>;

/** The request-wide checks: 1 to 200 operations, each with its own integer seq. */
export function checkOps(raw: unknown): RawOp[] {
  const ops = Array.isArray(raw) ? raw.map((op) => (typeof op === "object" && op !== null ? (op as RawOp) : {})) : [];
  const seqs = ops.map((op) => op.seq);
  const valid =
    Array.isArray(raw) &&
    ops.length >= 1 &&
    ops.length <= OPS_MAX &&
    seqs.every((seq) => typeof seq === "number" && Number.isInteger(seq) && seq >= 1 && seq <= SEQ_MAX) &&
    new Set(seqs).size === seqs.length;
  if (!valid) invalid({ ops: `Send 1 to ${OPS_MAX} operations, each with a different whole-number seq from 1 to ${SEQ_MAX}.` });
  return ops.sort((a, b) => (a.seq as number) - (b.seq as number));
}

/** What an op_id stands for: every key except op_id and seq. */
function contentOf(op: RawOp): RawOp {
  const { op_id: _id, seq: _seq, ...content } = op;
  return content;
}

/** A server id, or a client id that an earlier operation on this job mapped to one. */
async function resolveId(tx: Tx, jobId: string, raw: unknown, kind: "item" | "note"): Promise<unknown> {
  if (!isUuid(raw)) return raw;
  const mapped = await maybeOne<{ id: string }>(
    tx,
    kind === "item"
      ? "SELECT item_id AS id FROM sync_operations WHERE job_id = $1 AND client_item_id = $2"
      : "SELECT note_id AS id FROM sync_operations WHERE job_id = $1 AND client_note_id = $2",
    [jobId, raw],
  );
  return mapped?.id ?? raw;
}

/** Maps a pin stamped with an older plan revision through every later revision's transform. */
async function mapPin(tx: Tx, jobId: string, pin: unknown, stamp: number): Promise<unknown> {
  const later = await rows<{ transform: unknown }>(
    tx,
    "SELECT transform FROM plan_revisions WHERE job_id = $1 AND revision > $2 ORDER BY revision",
    [jobId, stamp],
  );
  if (later.length === 0 || typeof pin !== "object" || pin === null) return pin;
  const point = pin as Point;
  if (typeof point.x !== "number" || typeof point.y !== "number") return pin;
  return later.reduce((mapped, revision) => applyAffine(affineFromJson(revision.transform), mapped), point);
}

/** The op's plan revision stamp, checked against the job's current revision. */
async function planStamp(tx: Tx, jobId: string, raw: unknown): Promise<number | null> {
  const current = await maybeOne<{ revision: number }>(tx, "SELECT max(revision) AS revision FROM plan_revisions WHERE job_id = $1", [jobId]);
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 1 || raw > (current?.revision ?? 0)) {
    invalid({ plan_revision: "That plan revision is newer than the job's current plan." });
  }
  return raw;
}

function object(value: unknown): RawOp {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as RawOp) : {};
}

interface Evaluation {
  outcome: Outcome;
  itemId: string;
  noteId?: string;
}

async function evaluate(tx: Tx, access: JobAccess, op: RawOp): Promise<Evaluation> {
  const jobId = access.job.id;
  const rooms = await loadRooms(tx, jobId);
  switch (op.type) {
    case "create_item": {
      if (!isUuid(op.client_item_id)) invalid({ client_item_id: "Send a UUID made on the device." });
      if (await resolveId(tx, jobId, op.client_item_id, "item") !== op.client_item_id) {
        invalid({ client_item_id: "That client id already names an item." });
      }
      const stamp = await planStamp(tx, jobId, op.plan_revision);
      const fields = { ...object(op.fields) };
      if (stamp !== null && "pin" in fields) fields.pin = await mapPin(tx, jobId, fields.pin, stamp);
      return { outcome: "applied", itemId: await createItem(tx, access, fields, rooms) };
    }
    case "update_item": {
      const item = await visibleItem(tx, access, await resolveId(tx, jobId, op.item_id, "item"), access.role !== "trade");
      const stamp = await planStamp(tx, jobId, op.plan_revision);
      const changes = { ...object(op.changes) } as FieldChanges;
      if (stamp !== null && changes.pin && typeof changes.pin === "object") {
        changes.pin = {
          from: (await mapPin(tx, jobId, changes.pin.from, stamp)) as Point | null,
          to: (await mapPin(tx, jobId, changes.pin.to, stamp)) as Point | null,
        };
      }
      const conflicted = await mergeChanges(tx, access, item, changes, rooms);
      return { outcome: conflicted ? "conflict" : "applied", itemId: item.id };
    }
    case "item_action": {
      const itemId = await resolveId(tx, jobId, op.item_id, "item");
      await actOnItem(tx, access, itemId, { action: op.action, reason: op.reason });
      return { outcome: "applied", itemId: itemId as string };
    }
    case "add_note": {
      const itemId = await resolveId(tx, jobId, op.item_id, "item");
      if (op.client_note_id !== undefined && op.client_note_id !== null) {
        if (!isUuid(op.client_note_id)) invalid({ client_note_id: "Send a UUID made on the device." });
        if (await resolveId(tx, jobId, op.client_note_id, "note") !== op.client_note_id) {
          invalid({ client_note_id: "That client id already names a note." });
        }
      }
      const parentId = await resolveId(tx, jobId, op.parent_id, "note");
      const note = await addNote(tx, access, itemId, { body: op.body, audience: op.audience, parent_id: parentId });
      return { outcome: "applied", itemId: note.item_id, noteId: note.id };
    }
    case "edit_note": {
      const itemId = await resolveId(tx, jobId, op.item_id, "item");
      const noteId = await resolveId(tx, jobId, op.note_id, "note");
      const note = await editNote(tx, access, itemId, noteId, op);
      return { outcome: "applied", itemId: note.item_id };
    }
    default:
      invalid({ type: `Use ${OP_TYPES.join(", ")}.` });
  }
}

interface Step {
  result: Omit<SyncResult, "item">;
  itemId: string | null;
  gainedConflict: boolean;
}

/** The client ids an operation refers to: a rejected creation takes its dependants down with it. */
function referencedIds(op: RawOp): unknown[] {
  return [op.item_id, op.note_id, op.parent_id];
}

async function runOne(access: JobAccess, op: RawOp, failedIds: Set<string>): Promise<Step> {
  const opId = op.op_id;
  const seq = op.seq as number;
  const rejected = (error: ApiError, itemId: string | null = null): Step => {
    for (const created of [op.client_item_id, op.client_note_id]) if (typeof created === "string") failedIds.add(created);
    return { result: { op_id: String(opId), seq, outcome: "rejected", error: error.body() }, itemId, gainedConflict: false };
  };
  if (!isUuid(opId)) return rejected(new ApiError("validation", { op_id: "Send a UUID made on the device." }));
  const content = contentOf(op);
  try {
    return await transaction(async (tx) => {
      await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [opId]);
      const logged = await maybeOne<{ same: boolean; item_id: string | null }>(
        tx,
        "SELECT content = $2::jsonb AS same, item_id FROM sync_operations WHERE op_id = $1",
        [opId, JSON.stringify(content)],
      );
      if (logged && !logged.same) throw new ApiError("validation", { op_id: "This op_id was already used for a different operation." });
      if (logged) return { result: { op_id: opId, seq, outcome: "duplicate", error: null }, itemId: logged.item_id, gainedConflict: false };
      if (referencedIds(op).some((id) => typeof id === "string" && failedIds.has(id))) fail("not_found");
      const { outcome, itemId, noteId } = await evaluate(tx, access, op);
      await tx.query(
        `INSERT INTO sync_operations (op_id, job_id, person_id, content, outcome, item_id, client_item_id, client_note_id, note_id)
         VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8, $9)`,
        [
          opId,
          access.job.id,
          access.person.id,
          JSON.stringify(content),
          outcome,
          itemId,
          op.type === "create_item" ? op.client_item_id : null,
          op.type === "add_note" && isUuid(op.client_note_id) ? op.client_note_id : null,
          noteId ?? null,
        ],
      );
      return { result: { op_id: opId, seq, outcome, error: null }, itemId, gainedConflict: outcome === "conflict" };
    });
  } catch (error) {
    if (error instanceof ApiError) return rejected(error, isUuid(op.item_id) ? op.item_id : null);
    throw error;
  }
}

export async function runSync(access: JobAccess, ops: RawOp[]): Promise<SyncResponse> {
  const failedIds = new Set<string>();
  const steps: Step[] = [];
  for (const op of ops) steps.push(await runOne(access, op, failedIds));
  const ids = [...new Set(steps.map((step) => step.itemId).filter((id): id is string => id !== null))];
  const items = new Map((await loadItems(pool, access, ids)).map((item) => [item.id, projectItem(access, item)]));
  const distinct = (pick: (step: Step) => boolean) => new Set(steps.filter(pick).map((step) => step.itemId)).size;
  return {
    results: steps.map((step) => ({ ...step.result, item: step.itemId ? (items.get(step.itemId) ?? null) : null })),
    synced: distinct((step) => step.result.outcome === "applied"),
    conflicts: distinct((step) => step.gainedConflict),
  };
}
