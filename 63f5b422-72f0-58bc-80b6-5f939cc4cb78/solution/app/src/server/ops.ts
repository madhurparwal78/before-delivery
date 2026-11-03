import type pg from "pg";
import {
  affectedPages,
  applyChanges,
  execute,
  parseOperation,
  touchesOf,
  type ExecContext,
  type Executed,
  type Touches,
} from "../shared/apply.js";
import { ApiError, notFound } from "../shared/errors.js";
import { notice } from "../shared/notices.js";
import { valueText } from "../shared/styles.js";
import { locate } from "../shared/tree.js";
import type { Change, Created, DocBody, Person, StyleKey, StyleValue, WorkspaceDoc } from "../shared/types.js";
import { memberRole, requireEditor } from "./access.js";
import type { User } from "./auth.js";
import { all, newId, one, pool, transaction } from "./db.js";
import { broadcast, sendToUser } from "./live.js";

interface Ack {
  opId: string;
  seq: number;
  created?: Created;
}

/** Operations on one workspace are applied one at a time in arrival order (and under a row lock across instances). */
const lanes = new Map<string, Promise<unknown>>();
function inLane<T>(workspaceId: string, work: () => Promise<T>): Promise<T> {
  const previous = lanes.get(workspaceId) ?? Promise.resolve();
  const next = previous.then(work, work);
  lanes.set(
    workspaceId,
    next.catch(() => undefined),
  );
  return next;
}

async function lockDoc(tx: pg.PoolClient, workspaceId: string): Promise<WorkspaceDoc> {
  const row = await one<{ doc: WorkspaceDoc; seq: number }>(tx, "SELECT doc, seq FROM workspaces WHERE id = $1 FOR UPDATE", [workspaceId]);
  if (!row) throw notFound();
  return { ...row.doc, seq: row.seq };
}

interface Recorded {
  kind: string;
  opId: string | null;
  fields: Record<string, unknown>;
  created?: Created;
  changes: Change[];
  inverse: Change[];
  removed: Executed["removed"];
  before: WorkspaceDoc;
  after: WorkspaceDoc;
}

/** Write an accepted operation: next seq, document, change log, tombstones; then broadcast it. */
async function record(tx: pg.PoolClient, workspaceId: string, author: Person, op: Recorded): Promise<{ seq: number; touches: Touches }> {
  const seq = op.before.seq + 1;
  const touches = touchesOf(op.changes, op.inverse);
  const pages = affectedPages(op.before, op.after, op.changes);
  const doc: WorkspaceDoc = { ...op.after, seq };
  await tx.query("UPDATE workspaces SET doc = $2, seq = $3, slug = $4 WHERE id = $1", [workspaceId, JSON.stringify(doc), seq, doc.slug]);
  await tx.query(
    `INSERT INTO operations (workspace_id, seq, op_id, author_id, author_name, kind, fields, created, touch_keys, touch_nodes, structural, pages)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [workspaceId, seq, op.opId, author.id, author.name, op.kind, JSON.stringify(op.fields), op.created ? JSON.stringify(op.created) : null, touches.restore ? ["restore"] : touches.keys, touches.nodes, touches.structural, pages],
  );
  for (const subtree of op.removed) {
    const ids: { id: string; name: string }[] = [];
    const visit = (n: typeof subtree) => (ids.push({ id: n.id, name: n.name }), n.children.forEach(visit));
    visit(subtree);
    for (const { id, name } of ids)
      await tx.query(
        "INSERT INTO tombstones (workspace_id, node_id, node_name, deleted_by) VALUES ($1, $2, $3, $4) ON CONFLICT (workspace_id, node_id) DO UPDATE SET node_name = $3, deleted_by = $4",
        [workspaceId, id, name, author.name],
      );
  }
  return { seq, touches };
}

function pushStack(tx: pg.PoolClient, workspaceId: string, userId: string, stack: "undo" | "redo", seq: number, inverse: Change[]) {
  return tx.query("INSERT INTO undo_stack (workspace_id, user_id, stack, seq, inverse) VALUES ($1, $2, $3, $4, $5)", [workspaceId, userId, stack, seq, JSON.stringify(inverse)]);
}

/** A new edit of your own goes on your undo stack and clears your redo stack. */
async function pushOwnEdit(tx: pg.PoolClient, workspaceId: string, userId: string, seq: number, inverse: Change[]): Promise<void> {
  await tx.query("DELETE FROM undo_stack WHERE workspace_id = $1 AND user_id = $2 AND stack = 'redo'", [workspaceId, userId]);
  await pushStack(tx, workspaceId, userId, "undo", seq, inverse);
}

function announce(workspaceId: string, author: Person, seq: number, op: Recorded): void {
  broadcast(workspaceId, {
    type: "op",
    seq,
    author,
    op: { kind: op.kind, opId: op.opId, ...op.fields },
    changes: op.changes,
    created: op.created,
  });
}

function idsIn(body: Record<string, unknown>): { nodes: string[]; images: string[] } {
  const nodes = ["nodeId", "parentId"].map((k) => body[k]).filter((v): v is string => typeof v === "string");
  const images: string[] = [];
  const consider = (v: unknown) => typeof v === "string" && v.startsWith("img_") && images.push(v);
  consider((body.props as Record<string, unknown> | undefined)?.imageId);
  if (body.prop === "imageId") consider(body.value);
  if (body.values && typeof body.values === "object") Object.values(body.values).forEach(consider);
  return { nodes, images };
}

async function contextFor(tx: pg.PoolClient, workspaceId: string, body: Record<string, unknown>): Promise<ExecContext> {
  const { nodes, images } = idsIn(body);
  const tombs = await all<{ node_id: string; node_name: string; deleted_by: string }>(
    tx,
    "SELECT node_id, node_name, deleted_by FROM tombstones WHERE workspace_id = $1 AND node_id = ANY($2)",
    [workspaceId, nodes],
  );
  const imgs = await all<{ id: string; status: string }>(tx, "SELECT id, status FROM images WHERE workspace_id = $1 AND id = ANY($2)", [workspaceId, images]);
  return {
    newId: (prefix) => newId(prefix),
    tombstone: (id) => {
      const t = tombs.find((r) => r.node_id === id);
      return t && { nodeName: t.node_name, by: t.deleted_by };
    },
    image: (id) => {
      const status = imgs.find((r) => r.id === id)?.status;
      return status === "confirmed" ? "confirmed" : status === "pending" ? "pending" : "missing";
    },
  };
}

/** The not-found rule for ids in the body, ahead of the role check (API precedence). */
function checkIdsExist(doc: WorkspaceDoc, body: Record<string, unknown>, ctx: ExecContext): void {
  for (const key of ["nodeId", "parentId"]) {
    const id = body[key];
    if (typeof id === "string" && !locate(doc, id) && !ctx.tombstone?.(id)) throw notFound();
  }
  if (typeof body.pageId === "string" && !doc.pages.some((p) => p.id === body.pageId)) throw notFound();
  if (typeof body.componentId === "string" && !doc.components.some((c) => c.id === body.componentId)) throw notFound();
  if (typeof body.entryId === "string" && !doc.collection.entries.some((e) => e.id === body.entryId)) throw notFound();
  for (const image of idsIn(body).images) if (ctx.image?.(image) === "missing") throw notFound();
}

/** Accept one operation from a person: the only way any edit changes a document. */
export function submit(user: User, workspaceId: string, raw: unknown): Promise<Ack> {
  return inLane(workspaceId, async () => {
    const author: Person = { id: user.id, name: user.name };
    let conflicts: { opId: string; authorId: string }[] = [];
    let property: StyleKey | null = null;
    let value: StyleValue | undefined;
    const result = await transaction(async (tx) => {
      const doc = await lockDoc(tx, workspaceId);
      const role = await memberRole(user, workspaceId, tx);
      const body = typeof raw === "object" && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
      const ctx = await contextFor(tx, workspaceId, body);
      checkIdsExist(doc, body, ctx);
      requireEditor(role);
      if (typeof body.opId === "string") {
        const replay = await one<{ seq: number; created: Created | null }>(
          tx,
          "SELECT seq, created FROM operations WHERE workspace_id = $1 AND author_id = $2 AND op_id = $3",
          [workspaceId, user.id, body.opId],
        );
        if (replay) return { ack: { opId: body.opId, seq: replay.seq, ...(replay.created ? { created: replay.created } : {}) }, op: null };
      }
      if (body.kind === "restore") throw new ApiError(422, "invalid", "Restores are made through the restore route.", { kind: "A restore is written only by the restore route." });
      const parsed = parseOperation(raw);
      const op = parsed.op;
      if (op.kind === "undo" || op.kind === "redo") return unstack(tx, workspaceId, author, doc, op.kind, parsed.opId);
      const after: WorkspaceDoc = structuredClone(doc);
      const done = execute(after, parsed, ctx);
      const { kind, ...fields } = op;
      const recorded: Recorded = { kind, opId: parsed.opId, fields, created: done.created, changes: done.changes, inverse: done.inverse, removed: done.removed, before: doc, after };
      const { seq, touches } = await record(tx, workspaceId, author, recorded);
      await pushOwnEdit(tx, workspaceId, user.id, seq, done.inverse);
      if (op.kind === "set_style" || op.kind === "clear_style") {
        property = op.property;
        value = op.kind === "set_style" ? op.value : undefined;
        conflicts = (
          await all<{ op_id: string; author_id: string }>(
            tx,
            `SELECT op_id, author_id FROM operations WHERE workspace_id = $1 AND seq > $2 AND seq < $3 AND author_id <> $4
             AND kind IN ('set_style', 'clear_style') AND touch_keys && $5`,
            [workspaceId, parsed.baseSeq, seq, user.id, touches.keys],
          )
        ).map((r) => ({ opId: r.op_id, authorId: r.author_id }));
      }
      return { ack: { opId: parsed.opId, seq, ...(done.created ? { created: done.created } : {}) }, op: { seq, recorded } };
    });
    if ("skipped" in result) throw result.skipped;
    if (result.op) announce(workspaceId, author, result.op.seq, result.op.recorded);
    for (const loser of conflicts)
      if (property) sendToUser(workspaceId, loser.authorId, { type: "conflict", opId: loser.opId, property, value: valueText(value), winner: author });
    return result.ack;
  });
}

/** The name a can't-undo notice gives the thing someone else changed (a node, or a token's name). */
function changedName(doc: WorkspaceDoc, keys: string[], tombName: (id: string) => string | undefined): string {
  for (const key of keys) {
    const [kind, id] = key.split(":");
    if (kind === "token") return id;
    if (kind === "node" || kind === "prop" || kind === "style" || kind === "name" || kind === "bind" || kind === "shared") {
      const found = locate(doc, id);
      const name = found?.node.name ?? tombName(id);
      if (name) return name;
    }
  }
  return doc.pages[0]?.name ?? doc.name;
}

async function unstack(
  tx: pg.PoolClient,
  workspaceId: string,
  author: Person,
  doc: WorkspaceDoc,
  kind: "undo" | "redo",
  opId: string,
): Promise<{ ack: Ack; op: { seq: number; recorded: Recorded } } | { skipped: ApiError }> {
  const entry = await one<{ seq: number; inverse: Change[] }>(
    tx,
    "SELECT seq, inverse FROM undo_stack WHERE workspace_id = $1 AND user_id = $2 AND stack = $3 ORDER BY seq DESC LIMIT 1",
    [workspaceId, author.id, kind],
  );
  if (!entry) throw new ApiError(409, kind === "undo" ? "nothing_to_undo" : "nothing_to_redo", kind === "undo" ? notice.nothingToUndo : notice.nothingToRedo);
  const target = await one<{ touch_keys: string[]; touch_nodes: string[] }>(tx, "SELECT touch_keys, touch_nodes FROM operations WHERE workspace_id = $1 AND seq = $2", [workspaceId, entry.seq]);
  const restore = target?.touch_keys.includes("restore") ?? false;
  const blocker = await one<{ author_name: string; touch_keys: string[]; touch_nodes: string[]; structural: string[] }>(
    tx,
    `SELECT author_name, touch_keys, touch_nodes, structural FROM operations
     WHERE workspace_id = $1 AND seq > $2 AND author_id <> $3
       AND ($4 OR touch_keys && $5 OR structural && $6 OR 'restore' = ANY(touch_keys))
     ORDER BY seq LIMIT 1`,
    [workspaceId, entry.seq, author.id, restore, target?.touch_keys ?? [], target?.touch_nodes ?? []],
  );
  const dropEntry = () => tx.query("DELETE FROM undo_stack WHERE workspace_id = $1 AND user_id = $2 AND stack = $3 AND seq = $4", [workspaceId, author.id, kind, entry.seq]);
  const tombs = await all<{ node_id: string; node_name: string }>(tx, "SELECT node_id, node_name FROM tombstones WHERE workspace_id = $1", [workspaceId]);
  const tombName = (id: string) => tombs.find((t) => t.node_id === id)?.node_name;
  const skipped = async (name: string, keys: string[]): Promise<{ skipped: ApiError }> => {
    await dropEntry();
    return { skipped: new ApiError(409, "undo_skipped", notice.cantUndo(name, changedName(doc, keys, tombName))) };
  };
  if (blocker) {
    const shared = (target?.touch_keys ?? []).filter((k) => blocker.touch_keys.includes(k));
    const nodes = (target?.touch_nodes ?? []).filter((k) => blocker.structural.includes(k));
    return skipped(blocker.author_name, [...shared, ...nodes, ...blocker.touch_keys, ...blocker.touch_nodes]);
  }
  const after: WorkspaceDoc = structuredClone(doc);
  let inverse: Change[];
  try {
    inverse = applyChanges(after, entry.inverse);
  } catch {
    const last = await one<{ author_name: string; touch_keys: string[]; touch_nodes: string[] }>(
      tx,
      "SELECT author_name, touch_keys, touch_nodes FROM operations WHERE workspace_id = $1 AND seq > $2 AND author_id <> $3 ORDER BY seq DESC LIMIT 1",
      [workspaceId, entry.seq, author.id],
    );
    return skipped(last?.author_name ?? author.name, [...(last?.touch_keys ?? []), ...(last?.touch_nodes ?? [])]);
  }
  const removed = entry.inverse.filter((c): c is Extract<Change, { c: "remove" }> => c.c === "remove").map((c) => locate(doc, c.node)?.node).filter((n) => !!n);
  const recorded: Recorded = { kind, opId, fields: { target: entry.seq }, changes: entry.inverse, inverse, removed, before: doc, after };
  const { seq } = await record(tx, workspaceId, author, recorded);
  await dropEntry();
  await pushStack(tx, workspaceId, author.id, kind === "undo" ? "redo" : "undo", seq, inverse);
  return { ack: { opId, seq }, op: { seq, recorded } };
}

/** A restore: one accepted operation that makes the document equal to a version (except seq). */
export function commitRestore(user: User, workspaceId: string, version: { id: string; name: string; document: DocBody }): Promise<{ seq: number; version: VersionRow }> {
  return inLane(workspaceId, async () => {
    const author: Person = { id: user.id, name: user.name };
    const out = await transaction(async (tx) => {
      const doc = await lockDoc(tx, workspaceId);
      requireEditor(await memberRole(user, workspaceId, tx));
      const after: WorkspaceDoc = structuredClone(doc);
      const changes: Change[] = [{ c: "doc", doc: version.document }];
      const inverse = applyChanges(after, changes);
      const recorded: Recorded = { kind: "restore", opId: null, fields: { versionId: version.id, versionName: version.name }, changes, inverse, removed: [], before: doc, after };
      const { seq } = await record(tx, workspaceId, author, recorded);
      await pushOwnEdit(tx, workspaceId, user.id, seq, inverse);
      const restoredDoc: WorkspaceDoc = { ...after, seq };
      const versionName = `Restored ${version.name}`;
      const summary = await insertVersion(tx, workspaceId, author, restoredDoc, versionName);
      return { seq, recorded, summary };
    });
    announce(workspaceId, author, out.seq, out.recorded);
    broadcast(workspaceId, { type: "restored", by: author, versionName: version.name, seq: out.seq });
    return { seq: out.seq, version: out.summary };
  });
}

interface VersionRow {
  id: string;
  name: string;
  author: Person;
  createdAt: string;
  seq: number;
}

/** Cut a version holding the whole document; unnamed versions are `Version <n>`. */
export async function insertVersion(tx: pg.PoolClient, workspaceId: string, author: Person, doc: WorkspaceDoc, name: string | null): Promise<VersionRow> {
  await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`versions:${workspaceId}`]);
  const count = await one<{ n: number }>(tx, "SELECT count(*)::int AS n FROM versions WHERE workspace_id = $1", [workspaceId]);
  const position = (count?.n ?? 0) + 1;
  const id = newId("v");
  const { seq: _seq, ...body } = doc;
  const row = await one<{ created_at: Date }>(
    tx,
    "INSERT INTO versions (id, workspace_id, position, name, author_id, author_name, seq, document) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING created_at",
    [id, workspaceId, position, name ?? `Version ${position}`, author.id, author.name, doc.seq, JSON.stringify(body)],
  );
  return { id, name: name ?? `Version ${position}`, author, createdAt: (row?.created_at ?? new Date()).toISOString(), seq: doc.seq };
}

export async function changeLog(workspaceId: string, since: number): Promise<Record<string, unknown>[]> {
  const rows = await all<{ seq: number; op_id: string | null; kind: string; author_id: string; author_name: string; at: Date; fields: Record<string, unknown> }>(
    pool,
    "SELECT seq, op_id, kind, author_id, author_name, at, fields FROM operations WHERE workspace_id = $1 AND seq > $2 ORDER BY seq LIMIT 500",
    [workspaceId, since],
  );
  return rows.map((r) => ({ seq: r.seq, opId: r.op_id, kind: r.kind, author: { id: r.author_id, name: r.author_name }, at: r.at.toISOString(), ...r.fields }));
}
