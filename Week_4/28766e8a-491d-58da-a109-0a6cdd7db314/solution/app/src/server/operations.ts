// Server-ordered operations (brief: Working together, Operations over HTTP, Undo, Restore).
// Each diagram applies one operation at a time: lock, replay check, apply, store, broadcast.
import type pg from "pg";
import { copy, labelFor, shapeLabel } from "../shared/copy";
import { ApiError } from "../shared/errors";
import { BAD_VALUE, changedShapeIds, commit, OpError, parseRequest, referencedIds, restoredFields, type Committed, type ParsedRequest } from "../shared/ops";
import { canEdit, isOwner } from "../shared/rules";
import type { Change, DiagramDocument, FlatRecord, OperationResult, ShapeKind } from "../shared/types";
import { diagramAccess, requireRole, type Access } from "./access";
import { requireUser, type SessionUser } from "./auth";
import { config } from "./config";
import { one, transaction } from "./db";
import { json, route } from "./http";
import { newId, token } from "./ids";
import { broadcast } from "./live";

/** Diagrams under a grading save outage, until the given server time. */
const outages = new Map<string, number>();

export function startOutage(diagramId: string, ms: number): number {
  const until = Date.now() + ms;
  outages.set(diagramId, until);
  return until;
}

export function inOutage(diagramId: string): boolean {
  return (outages.get(diagramId) ?? 0) > Date.now();
}

/** One operation at a time per diagram in this process, so acknowledgements and broadcasts leave in seq order. */
const queues = new Map<string, Promise<unknown>>();

function serialised<T>(diagramId: string, work: () => Promise<T>): Promise<T> {
  const previous = queues.get(diagramId) ?? Promise.resolve();
  const next = previous.then(work, work);
  queues.set(diagramId, next.catch(() => undefined));
  return next;
}

function canonical(value: unknown): string {
  return JSON.stringify(value ?? null, (_key, v: unknown) =>
    v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : 1))) : v);
}

interface Deletion {
  name: string;
  label: string;
}

const OBJECT_TYPES: Record<string, string> = { s_: "shape", c_: "connector", p_: "page", l_: "layer", g_: "group" };

/** Who deleted an object that once belonged to this diagram, or null when it never did. */
async function deletion(db: pg.PoolClient, diagramId: string, id: string): Promise<Deletion | null> {
  const type = OBJECT_TYPES[id.slice(0, 2)] ?? "group";
  const { rows } = await db.query<{ name: string; changes: Change[] }>(
    `SELECT u.name, o.changes FROM operations o JOIN users u ON u.id = o.user_id
      WHERE o.diagram_id = $1 AND o.touched ? $2 ORDER BY o.seq DESC LIMIT 1`, [diagramId, `${type}:${id}:deleted`]);
  const row = rows[0];
  if (!row) return null;
  const before = row.changes.find((c) => c.key === `${type}:${id}`)?.before as FlatRecord | undefined;
  const label = type === "shape" && before ? shapeLabel({ label: before.label as string, kind: before.kind as ShapeKind })
    : typeof before?.label === "string" && before.label ? before.label : typeof before?.name === "string" ? before.name : "Connector";
  return { name: row.name, label };
}

function inDocument(doc: DiagramDocument, id: string): boolean {
  return doc.pages.some((p) => p.id === id || p.layers.some((l) => l.id === id) || p.shapes.some((s) => s.id === id)
    || p.connectors.some((c) => c.id === id) || p.groups.some((g) => g.id === id));
}

interface Accepted {
  result: OperationResult;
  committed: Committed;
  author: { id: string; name: string };
  replaced: string[];
  label: string;
  restored: string | null;
}

interface RunOptions {
  socket: boolean;
  /** The live socket the operation arrived on; it gets the acknowledgement instead of the broadcast. */
  origin?: number;
  /** The restore endpoint passes its own operation and display name. */
  restore?: { versionId: string; displayName: string; document: DiagramDocument };
  /** Runs inside the operation's transaction once it is stored (the restore cuts its version here). */
  after?: (db: pg.PoolClient) => Promise<void>;
}

/** Runs one received operation under the full error precedence; returns the stored response for a replay. */
export async function runOperation(user: SessionUser, diagramId: string, raw: unknown, options: RunOptions): Promise<{ result: OperationResult; replayed: boolean }> {
  type Outcome = { replay: OperationResult } | { accepted: Accepted; anchoring: boolean };
  const outcome = await serialised(diagramId, () => transaction(async (db): Promise<Outcome> => {
    const access = await diagramAccess(user, diagramId, db);
    const locked = one((await db.query<{ doc: DiagramDocument; seq: number }>("SELECT doc, seq FROM diagrams WHERE id = $1 FOR UPDATE", [diagramId])).rows);
    const doc = { ...locked.doc, seq: locked.seq };
    const request: ParsedRequest = options.restore
      ? { opId: `restore-${token()}`, baseSeq: doc.seq, op: { kind: "restore", version: options.restore.versionId }, fields: {}, received: null }
      : parseRequest(raw, options.socket);
    const { op, opId } = request;

    const deleted = new Map<string, Deletion>();
    for (const id of op ? referencedIds(op) : []) {
      // A missing or malformed id is a validation error (422), answered after the higher-precedence checks.
      if (!id || inDocument(doc, id)) continue;
      const found = await deletion(db, diagramId, id);
      if (!found || !(id.startsWith("s_") || id.startsWith("c_"))) throw new ApiError("not_found");
      deleted.set(id, found);
    }
    requireRole(access, options.restore ? isOwner : canEdit, copy.role);

    let conflict = false;
    if (opId) {
      const stored = await db.query<{ body: unknown; response: OperationResult }>(
        "SELECT body, response FROM operations WHERE diagram_id = $1 AND user_id = $2 AND op_id = $3", [diagramId, user.id, opId]);
      const previous = stored.rows[0];
      if (previous && canonical(previous.body) === canonical(request.received)) return { replay: previous.response };
      conflict = !!previous;
    }
    if (inOutage(diagramId)) throw new ApiError("save_unavailable");
    if (conflict) throw new ApiError("op_conflict");
    if (!op) throw new ApiError("invalid", undefined, request.fields);

    let undone: Change[] = [];
    if (op.kind === "undo") undone = await undoTarget(db, access, op.seq, doc);
    let committed: Committed;
    try {
      committed = commit(doc, op, {
        newId: (prefix) => newId(prefix),
        changesOf: () => undone,
        versionDocument: () => {
          if (!options.restore) throw new OpError("invalid", "op");
          return options.restore.document;
        },
      });
    } catch (error) {
      if (!(error instanceof OpError)) throw error;
      if (error.code === "layer_locked") throw new ApiError("layer_locked", copy.locked(error.subject));
      const gone = deleted.get(error.subject);
      if (error.code === "missing" && gone) throw new ApiError(error.subject.startsWith("s_") ? "shape_deleted" : "connector_deleted", copy.deleted(gone.label, gone.name));
      if (error.code === "missing" && error.subject) throw new ApiError("not_found");
      throw new ApiError("invalid", undefined, error.code === "missing" ? request.fields : { ...request.fields, [error.subject]: BAD_VALUE });
    }
    if (Object.keys(request.fields).length) throw new ApiError("invalid", undefined, request.fields);
    const seq = doc.seq + 1;
    const result: OperationResult = { opId, seq, ids: committed.ids, rerouted: committed.rerouted };
    const stored = { ...committed.document, seq };
    await db.query(
      "INSERT INTO operations (diagram_id, seq, user_id, op_id, body, response, changes, touched) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
      [diagramId, seq, user.id, opId, JSON.stringify(options.restore ? op : request.received), JSON.stringify(result), JSON.stringify(committed.changes), JSON.stringify(committed.touched)]);
    await db.query(
      `UPDATE diagrams SET doc = $2, seq = $3, updated_at = now(),
              version_due_author = CASE WHEN version_due_at IS NULL THEN $4 ELSE version_due_author END,
              version_due_at = COALESCE(version_due_at, now() + ($5 || ' milliseconds')::interval)
        WHERE id = $1`, [diagramId, JSON.stringify(stored), seq, user.id, String(config.versionIntervalMs)]);
    const fields = setFields(committed.changes);
    const replaced = fields.length && op.kind !== "undo" && op.kind !== "restore" ? await overwritten(db, diagramId, seq, user.id, fields) : [];
    const anchoring = await reanchor(db, diagramId, committed);
    await options.after?.(db);
    const labels = changedShapeIds(committed.changes).map((id) => {
      const change = committed.changes.find((c) => c.key === `shape:${id}`);
      const record = (change?.after ?? change?.before) as FlatRecord;
      return shapeLabel({ label: record.label as string, kind: record.kind as ShapeKind });
    });
    const accepted: Accepted = {
      result, committed, author: { id: user.id, name: user.name }, replaced, label: labelFor(labels),
      restored: options.restore?.displayName ?? null,
    };
    return { accepted, anchoring };
  }));
  if ("replay" in outcome) return { result: outcome.replay, replayed: true };
  const { accepted } = outcome;
  const shared = { opId: accepted.result.opId, seq: accepted.result.seq, changes: accepted.committed.changes,
    routes: accepted.committed.routes, author: accepted.author, restored: accepted.restored };
  broadcast(diagramId, { type: "op", ...shared, replaced: accepted.replaced, label: accepted.label },
    options.origin === undefined ? undefined : { socketId: options.origin, ack: { type: "ack", ...shared, ids: accepted.result.ids, rerouted: accepted.result.rerouted } });
  if (outcome.anchoring) broadcast(diagramId, { type: "comments" });
  return { result: accepted.result, replayed: false };
}

/**
 * The authors whose value this operation replaced: for each field it sets, the author of the latest earlier
 * operation that set the same field, when that is someone else (brief: Same field changed by two people).
 */
async function overwritten(db: pg.PoolClient, diagramId: string, seq: number, userId: string, fields: string[]): Promise<string[]> {
  const { rows } = await db.query<{ user_id: string; touched: string[] }>(
    "SELECT user_id, touched FROM operations WHERE diagram_id = $1 AND seq < $2 AND touched ?| $3 ORDER BY seq DESC", [diagramId, seq, fields]);
  const open = new Set(fields);
  const authors = new Set<string>();
  for (const row of rows) {
    const hit = row.touched.filter((key) => open.has(key));
    for (const key of hit) open.delete(key);
    // Creating a shape (or bringing it back) gives it its values without anyone's edit being replaced.
    const set = hit.filter((key) => !row.touched.includes(`${key.slice(0, key.lastIndexOf(":"))}:created`));
    if (set.length && row.user_id !== userId) authors.add(row.user_id);
    if (!open.size) break;
  }
  return [...authors];
}

/** The editable shape fields an operation changed on shapes that existed before and after it. */
function setFields(changes: Change[]): string[] {
  return changes.flatMap((c) => (c.key.startsWith("shape:") && c.before && c.after
    ? EDITABLE_FIELDS.filter((f) => JSON.stringify(c.before?.[f]) !== JSON.stringify(c.after?.[f])).map((f) => `${c.key}:${f}`) : []));
}

const EDITABLE_FIELDS = ["x", "y", "w", "h", "label", "layer"] as const;

/** The stored changes an undo reverses; refuses when someone else changed one of those fields later. */
async function undoTarget(db: pg.PoolClient, access: Access, targetSeq: number, doc: DiagramDocument): Promise<Change[]> {
  const { rows } = await db.query<{ user_id: string; changes: Change[]; touched: string[] }>(
    "SELECT user_id, changes, touched FROM operations WHERE diagram_id = $1 AND seq = $2", [access.diagramId, targetSeq]);
  const target = rows[0];
  if (!target || target.user_id !== access.user.id) throw new ApiError("invalid");
  const fields = restoredFields(target.touched);
  const later = await db.query<{ name: string; touched: string[] }>(
    `SELECT u.name, o.touched FROM operations o JOIN users u ON u.id = o.user_id
      WHERE o.diagram_id = $1 AND o.seq > $2 AND o.user_id <> $3 AND o.touched ?| $4 ORDER BY o.seq LIMIT 1`,
    [access.diagramId, targetSeq, access.user.id, fields]);
  const blocker = later.rows[0];
  if (blocker) {
    const key = blocker.touched.find((k) => fields.includes(k)) ?? "";
    const [type, id] = key.split(":") as [string, string];
    const shape = doc.pages.flatMap((p) => p.shapes).find((s) => s.id === id);
    const page = doc.pages.find((p) => p.id === id || p.layers.some((l) => l.id === id));
    const label = type === "shape" && shape ? shapeLabel(shape) : (page?.layers.find((l) => l.id === id)?.name ?? page?.name ?? "the diagram");
    throw new ApiError("undo_conflict", copy.cantUndo(blocker.name, label));
  }
  return target.changes;
}

/** Comment anchoring follows shape existence: a deleted shape unanchors its comments, a returning one re-anchors them. */
async function reanchor(db: pg.PoolClient, diagramId: string, committed: Committed): Promise<boolean> {
  const appeared = committed.changes.filter((c) => c.key.startsWith("shape:") && !c.before).map((c) => c.key.slice(6));
  const vanished = committed.changes.filter((c) => c.key.startsWith("shape:") && !c.after).map((c) => c.key.slice(6));
  let changed = 0;
  if (appeared.length) changed += (await db.query("UPDATE comments SET anchored = true WHERE diagram_id = $1 AND shape_id = ANY($2) AND NOT anchored", [diagramId, appeared])).rowCount ?? 0;
  if (vanished.length) changed += (await db.query("UPDATE comments SET anchored = false WHERE diagram_id = $1 AND shape_id = ANY($2) AND anchored", [diagramId, vanished])).rowCount ?? 0;
  return changed > 0;
}

route("POST", "/api/diagrams/:id/operations", async (req) => {
  const user = await requireUser(req);
  return json(200, (await runOperation(user, req.params[0] as string, req.body, { socket: false })).result);
});
