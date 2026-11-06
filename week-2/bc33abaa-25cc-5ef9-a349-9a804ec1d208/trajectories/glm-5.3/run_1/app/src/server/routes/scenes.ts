import { Router, type Request, type Response } from "express";
import { randomBytes } from "node:crypto";
import { pool, query } from "../db";
import { errors, requireAuth, canEditScene, assertNotReadOnly } from "../http";
import { audit } from "../audit";
import { applyOp, lockableNodes, type OpIn } from "../ops";
import { cloneGraph, graphHash, REST_STATE } from "../../shared/graph";
import type { Graph, Node } from "../../shared/graph-types";
import type { Caller } from "../auth";
import { publishOps } from "../realtime";
import { pocketbase } from "../services";

export interface AuthorInfo {
  kind: "member" | "agent" | "system";
  id: string;
  name: string;
}

export function callerAuthor(caller: Caller): AuthorInfo {
  if (caller.kind === "agent") return { kind: "agent", id: caller.token.id, name: caller.token.name };
  return { kind: "member", id: caller.member.id, name: caller.member.name };
}

export function authorKey(author: AuthorInfo): string {
  return `${author.kind}:${author.id}`;
}

export interface SceneRow {
  id: string;
  workspace_id: string;
  name: string;
  embed_id: string | null;
}

export async function getSceneRow(sceneId: string, workspaceId: string): Promise<SceneRow> {
  const res = await query("SELECT id, workspace_id, name, embed_id FROM scenes WHERE id = $1", [sceneId]);
  const row = res.rows[0] as SceneRow | undefined;
  if (!row) throw errors.notFound();
  if (workspaceId !== "" && row.workspace_id !== workspaceId) throw errors.notFound();
  return row;
}

export async function latestSeq(sceneId: string): Promise<number> {
  const res = await query("SELECT coalesce(max(seq), 0) AS latest FROM ops WHERE scene_id = $1", [sceneId]);
  return Number((res.rows[0] as { latest: string }).latest);
}

export async function baseGraph(sceneId: string): Promise<Graph> {
  const res = await query("SELECT graph FROM scene_bases WHERE scene_id = $1", [sceneId]);
  const row = res.rows[0] as { graph: Graph } | undefined;
  if (!row) throw errors.notFound();
  return row.graph;
}

export async function sceneAssetIds(sceneId: string): Promise<Set<string>> {
  const res = await query(
    "SELECT a.id FROM assets a JOIN scenes s ON s.workspace_id = a.workspace_id WHERE s.id = $1",
    [sceneId],
  );
  return new Set(res.rows.map((r) => (r as { id: string }).id));
}

export async function graphAt(sceneId: string, at: number): Promise<{ graph: Graph; latest: number }> {
  const latest = await latestSeq(sceneId);
  if (at < 0 || at > latest) throw errors.validation({ at: "Out of range" });
  const base = await baseGraph(sceneId);
  const graph = cloneGraph(base);
  if (at > 0) {
    const res = await query(
      "SELECT type, payload FROM ops WHERE scene_id = $1 AND seq <= $2 ORDER BY seq",
      [sceneId, at],
    );
    const assetIds = await sceneAssetIds(sceneId);
    for (const row of res.rows as { type: string; payload: Record<string, unknown> }[]) {
      applyOp(graph, { type: row.type, payload: row.payload }, assetIds);
    }
  }
  return { graph, latest };
}

export interface OpOut {
  seq: number;
  batchId: string;
  type: string;
  payload: Record<string, unknown>;
  inverse: { type: string; payload: Record<string, unknown> };
  author: AuthorInfo;
  createdAt: string;
  undoOf: string | null;
  redoOf: string | null;
  restoreTo: number | null;
}

interface OpRow {
  seq: string;
  batch_id: string;
  type: string;
  payload: Record<string, unknown>;
  inverse: { type: string; payload: Record<string, unknown> };
  author_kind: string;
  author_id: string;
  author_name: string;
  created_at: Date;
  undo_of: string | null;
  redo_of: string | null;
  restore_to: string | null;
}

export function opRowToOp(row: OpRow): OpOut {
  return {
    seq: Number(row.seq),
    batchId: row.batch_id,
    type: row.type,
    payload: row.payload,
    inverse: row.inverse,
    author: { kind: row.author_kind as AuthorInfo["kind"], id: row.author_id, name: row.author_name },
    createdAt: row.created_at.toISOString().replace(/\.\d{3}Z$/, "Z"),
    undoOf: row.undo_of,
    redoOf: row.redo_of,
    restoreTo: row.restore_to === null ? null : Number(row.restore_to),
  };
}

// ---------------------------------------------------------------------------
// Locks (PocketBase is the store; a short-lived cache avoids repeat lookups)
// ---------------------------------------------------------------------------

const lockCache = new Map<string, { at: number; locks: Map<string, AuthorInfo> }>();

function invalidateLockCache(sceneId: string): void {
  lockCache.delete(sceneId);
}

export async function activeLocks(sceneId: string): Promise<Map<string, AuthorInfo>> {
  const cached = lockCache.get(sceneId);
  if (cached && Date.now() - cached.at < 500) return cached.locks;
  const scene = await getSceneRow(sceneId, "");
  const records = await pocketbase().locks(sceneId, scene.workspace_id);
  const now = Date.now();
  const locks = new Map<string, AuthorInfo>();
  for (const r of records) {
    if (new Date(r.expiresAt).getTime() > now) {
      locks.set(r.node, { kind: r.holderKind, id: r.holderId, name: r.holderName });
    }
  }
  lockCache.set(sceneId, { at: now, locks });
  return locks;
}

export async function tryClaim(sceneId: string, nodeId: string, author: AuthorInfo): Promise<boolean> {
  invalidateLockCache(sceneId);
  const current = await pocketbase().findLock(sceneId, nodeId);
  const kind = author.kind === "system" ? "member" : author.kind;
  if (current && new Date(current.expiresAt).getTime() > Date.now() && !(current.holderId === author.id && current.holderKind === kind)) {
    return false;
  }
  if (current && !(current.holderId === author.id && current.holderKind === kind)) {
    const released = await pocketbase().releaseLock(sceneId, nodeId, current.holderId);
    if (!released) return false;
  }
  const scene = await getSceneRow(sceneId, "");
  return pocketbase().takeLock(scene.workspace_id, sceneId, nodeId, kind, author.id, author.name);
}

export async function claimLocks(sceneId: string, author: AuthorInfo, nodeIds: string[]): Promise<void> {
  if (nodeIds.length === 0) return;
  const locks = await activeLocks(sceneId);
  for (const nodeId of nodeIds) {
    const holder = locks.get(nodeId);
    if (holder && !(holder.id === author.id && holder.kind === author.kind)) {
      throw errors.conflict("locked", { nodeId, holder });
    }
  }
  for (const nodeId of nodeIds) {
    if (!locks.has(nodeId)) {
      const won = await tryClaim(sceneId, nodeId, author);
      if (!won) {
        const fresh = await activeLocks(sceneId);
        const holder = fresh.get(nodeId) ?? author;
        throw errors.conflict("locked", { nodeId, holder });
      }
      locks.set(nodeId, author);
    }
  }
}

export async function releaseLock(sceneId: string, nodeId: string, holderId: string): Promise<void> {
  invalidateLockCache(sceneId);
  await pocketbase().releaseLock(sceneId, nodeId, holderId);
}

export async function holderOf(sceneId: string, nodeId: string): Promise<AuthorInfo | null> {
  const locks = await activeLocks(sceneId);
  return locks.get(nodeId) ?? null;
}

// ---------------------------------------------------------------------------
// Batches
// ---------------------------------------------------------------------------

export interface BatchMeta {
  undoOf?: string;
  redoOf?: string;
  restoreTo?: number;
}

export interface AppendFailure extends Error {
  opIndex: number;
  field: string;
  message: string;
  nodeId: string | null;
}

function appendFailure(opIndex: number, field: string, message: string, nodeId: string | null): AppendFailure {
  const err = new Error("append_failure") as AppendFailure;
  err.opIndex = opIndex;
  err.field = field;
  err.message = message;
  err.nodeId = nodeId;
  return err;
}

export function isAppendFailure(e: unknown): e is AppendFailure {
  return typeof e === "object" && e !== null && "opIndex" in e;
}

export async function appendBatch(
  sceneId: string,
  author: AuthorInfo,
  ops: OpIn[],
  meta: BatchMeta,
): Promise<{ batchId: string; firstSeq: number; lastSeq: number; latestSeq: number; hash: string }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const seqRes = await client.query(
      "SELECT coalesce(max(seq),0) AS latest FROM ops WHERE scene_id = $1",
      [sceneId],
    );
    const latest = Number((seqRes.rows[0] as { latest: string }).latest);
    const baseRes = await client.query("SELECT graph FROM scene_bases WHERE scene_id = $1", [sceneId]);
    const graph = cloneGraph((baseRes.rows[0] as { graph: Graph }).graph);
    const assetRes = await client.query(
      "SELECT a.id FROM assets a JOIN scenes s ON s.workspace_id = a.workspace_id WHERE s.id = $1",
      [sceneId],
    );
    const assetIds = new Set(assetRes.rows.map((r) => (r as { id: string }).id));
    const prepared: { type: string; payload: Record<string, unknown>; inverse: { type: string; payload: Record<string, unknown> } }[] = [];
    const lockNodes = new Set<string>();
    for (let i = 0; i < ops.length; i++) {
      const op = ops[i]!;
      for (const nodeId of lockableNodes(op, graph)) lockNodes.add(nodeId);
      const result = applyOp(graph, op, assetIds);
      if (!result.ok) {
        await client.query("ROLLBACK");
        throw appendFailure(i, result.field, result.message, nodeIdOfOp(op));
      }
      prepared.push({ type: op.type, payload: op.payload, inverse: result.inverse });
    }
    await claimLocks(sceneId, author, [...lockNodes]);
    const batchId = `batch_${randomBytes(8).toString("hex")}`;
    const createdAt = new Date();
    let seq = latest;
    for (const op of prepared) {
      seq += 1;
      await client.query(
        `INSERT INTO ops (seq, batch_id, scene_id, type, payload, inverse, author_kind, author_id, author_name, created_at, undo_of, redo_of, restore_to)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [seq, batchId, sceneId, op.type, JSON.stringify(op.payload), JSON.stringify(op.inverse), author.kind, author.id, author.name, createdAt, meta.undoOf ?? null, meta.redoOf ?? null, meta.restoreTo ?? null],
      );
    }
    if (author.kind !== "system") {
      const key = authorKey(author);
      const isUndoRedo = meta.undoOf !== undefined || meta.redoOf !== undefined;
      await client.query(
        "INSERT INTO author_batches (scene_id, author_key, batch_id, first_seq) VALUES ($1,$2,$3,$4)",
        [sceneId, key, batchId, latest + 1],
      );
      if (!isUndoRedo) {
        await client.query(
          "UPDATE author_batches SET redo_cleared = TRUE WHERE scene_id = $1 AND author_key = $2 AND undone = TRUE AND redo_cleared = FALSE",
          [sceneId, key],
        );
      }
      if (meta.undoOf !== undefined) {
        await client.query(
          "UPDATE author_batches SET undone = TRUE, undone_by_seq = $3, redo_cleared = FALSE WHERE scene_id = $1 AND author_key = $2 AND batch_id = $4",
          [sceneId, key, latest + 1, meta.undoOf],
        );
      }
      if (meta.redoOf !== undefined) {
        await client.query(
          "UPDATE author_batches SET undone = FALSE, undone_by_seq = NULL, redo_cleared = FALSE WHERE scene_id = $1 AND author_key = $2 AND batch_id = $3",
          [sceneId, key, meta.redoOf],
        );
      }
    }
    await client.query("COMMIT");
    const hash = graphHash(graph);
    const result = { batchId, firstSeq: latest + 1, lastSeq: seq, latestSeq: seq, hash };
    const opEvents: OpOut[] = prepared.map((op, i) => ({
      seq: latest + 1 + i,
      batchId,
      type: op.type,
      payload: op.payload,
      inverse: op.inverse,
      author,
      createdAt: createdAt.toISOString().replace(/\.\d{3}Z$/, "Z"),
      undoOf: meta.undoOf ?? null,
      redoOf: meta.redoOf ?? null,
      restoreTo: meta.restoreTo ?? null,
    }));
    publishOps(sceneId, { batchId, ops: opEvents });
    return result;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

export function nodeIdOfOp(op: OpIn): string | null {
  const p = op.payload;
  if (op.type === "node.add") {
    const n = p.node as { id?: unknown } | undefined;
    return typeof n?.id === "string" ? n.id : null;
  }
  if (op.type === "state.add" || op.type === "state.remove" || op.type === "transition.set" || op.type === "camera.view.set") {
    return null;
  }
  if (typeof p.id === "string") return p.id;
  if (typeof p.nodeId === "string") return p.nodeId;
  return null;
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export const scenesRouter = Router();
scenesRouter.use(requireAuth);

async function callerWorkspaceId(req: Request): Promise<string> {
  const caller = req.caller!;
  return caller.kind === "agent" ? caller.token.workspace_id : caller.member.workspace_id;
}

scenesRouter.get("/", async (req, res, next) => {
  try {
    const ws = await callerWorkspaceId(req);
    const rows = await query(
      `SELECT s.id, s.name, s.created_at,
        (SELECT coalesce(max(seq),0) FROM ops o WHERE o.scene_id = s.id) AS latest_seq,
        (SELECT max(v.created_at) FROM versions v WHERE v.scene_id = s.id) AS updated_at,
        (SELECT v.number FROM versions v WHERE v.scene_id = s.id AND v.state = 'published' ORDER BY v.number DESC LIMIT 1) AS published_version
       FROM scenes s WHERE s.workspace_id = $1 ORDER BY s.created_at`,
      [ws],
    );
    const scenes = rows.rows.map((r) => {
      const row = r as { id: string; name: string; latest_seq: string; created_at: Date; updated_at: Date | null; published_version: number | null };
      return {
        id: row.id,
        name: row.name,
        latestSeq: Number(row.latest_seq),
        updatedAt: (row.updated_at ?? row.created_at).toISOString().replace(/\.\d{3}Z$/, "Z"),
        publishedVersion: row.published_version === null ? null : Number(row.published_version),
      };
    });
    res.json({ scenes });
  } catch (e) {
    next(e);
  }
});

scenesRouter.post("/", async (req, res, next) => {
  try {
    const caller = req.caller!;
    if (caller.kind === "agent") throw errors.forbidden();
    if (caller.member.role !== "owner" && caller.member.role !== "editor") throw errors.forbidden();
    const ws = caller.member.workspace_id;
    await assertNotReadOnly(ws);
    const name = req.body?.name;
    if (typeof name !== "string" || name.length < 1 || name.length > 80) {
      throw errors.validation({ name: "Name must be 1-80 characters" });
    }
    const id = `scene_${randomBytes(9).toString("hex")}`;
    const root: Node = {
      id: "n_root", name: "Scene", kind: "group", parentId: null, primitive: null, assetId: null,
      position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], materialLayers: [], visible: true,
    };
    const graph: Graph = { nodes: [root], states: [{ ...REST_STATE, overrides: [] }], transitions: [], cameraViews: [] };
    await query("INSERT INTO scenes (id, workspace_id, name) VALUES ($1,$2,$3)", [id, ws, name]);
    await query("INSERT INTO scene_bases (scene_id, graph) VALUES ($1,$2)", [id, JSON.stringify(graph)]);
    audit(caller, "scene.created", { type: "scene", id });
    res.status(201).json({ id, name, latestSeq: 0 });
  } catch (e) {
    next(e);
  }
});

scenesRouter.get("/search", async (req, res, next) => {
  try {
    const ws = await callerWorkspaceId(req);
    const q = String(req.query.q ?? "");
    if (q.length < 2) throw errors.validation({ q: "At least 2 characters" });
    const like = `%${q.toLowerCase()}%`;
    const scenes = await query(
      "SELECT id, name FROM scenes WHERE workspace_id = $1 AND lower(name) LIKE $2 ORDER BY name",
      [ws, like],
    );
    const assets = await query(
      "SELECT id, name FROM assets WHERE workspace_id = $1 AND lower(name) LIKE $2 ORDER BY name",
      [ws, like],
    );
    res.json({
      scenes: scenes.rows.map((r) => ({ id: (r as { id: string }).id, name: (r as { name: string }).name })),
      assets: assets.rows.map((r) => ({ id: (r as { id: string }).id, name: (r as { name: string }).name })),
    });
  } catch (e) {
    next(e);
  }
});

scenesRouter.get("/:sceneId", async (req, res, next) => {
  try {
    const ws = await callerWorkspaceId(req);
    const scene = await getSceneRow(req.params.sceneId, ws);
    const latest = await latestSeq(scene.id);
    const { graph } = await graphAt(scene.id, latest);
    res.json({ id: scene.id, name: scene.name, latestSeq: latest, graph, hash: graphHash(graph) });
  } catch (e) {
    next(e);
  }
});

scenesRouter.get("/:sceneId/graph", async (req, res, next) => {
  try {
    const ws = await callerWorkspaceId(req);
    const scene = await getSceneRow(req.params.sceneId, ws);
    const atRaw = req.query.at;
    const latest = await latestSeq(scene.id);
    let at: number;
    if (atRaw === undefined) {
      at = latest;
    } else {
      at = Number(atRaw);
      if (!Number.isInteger(at) || at < 0 || at > latest) {
        throw errors.validation({ at: "Out of range" });
      }
    }
    const { graph } = await graphAt(scene.id, at);
    res.json({ seq: at, graph, hash: graphHash(graph) });
  } catch (e) {
    next(e);
  }
});

scenesRouter.get("/:sceneId/ops", async (req, res, next) => {
  try {
    const ws = await callerWorkspaceId(req);
    const scene = await getSceneRow(req.params.sceneId, ws);
    const after = Number(req.query.after ?? 0);
    const limitRaw = Number(req.query.limit ?? 500);
    const limit = Math.min(Math.max(Number.isInteger(limitRaw) ? limitRaw : 500, 1), 1000);
    const latest = await latestSeq(scene.id);
    const rows = await query(
      "SELECT * FROM ops WHERE scene_id = $1 AND seq > $2 ORDER BY seq LIMIT $3",
      [scene.id, Number.isFinite(after) ? after : 0, limit],
    );
    res.json({ ops: (rows.rows as unknown as OpRow[]).map(opRowToOp), latestSeq: latest });
  } catch (e) {
    next(e);
  }
});

scenesRouter.post("/:sceneId/ops", async (req, res, next) => {
  try {
    const caller = req.caller!;
    const ws = await callerWorkspaceId(req);
    const scene = await getSceneRow(req.params.sceneId, ws);
    if (!canEditScene(caller)) throw errors.forbidden();
    await assertNotReadOnly(ws);
    const opsIn = req.body?.ops;
    if (!Array.isArray(opsIn) || opsIn.length < 1 || opsIn.length > 200) {
      throw errors.validation({ ops: "1-200 operations required" });
    }
    const ops: OpIn[] = [];
    for (let i = 0; i < opsIn.length; i++) {
      const op = opsIn[i] as { type?: unknown; payload?: unknown } | undefined;
      if (typeof op !== "object" || op === null || typeof op.type !== "string") {
        throw errors.validation({ [`ops[${i}].type`]: "Unknown operation" });
      }
      if (typeof op.payload !== "object" || op.payload === null) {
        throw errors.validation({ [`ops[${i}].payload`]: "Payload is required" });
      }
      ops.push({ type: op.type, payload: op.payload as Record<string, unknown> });
    }
    const author = callerAuthor(caller);
    try {
      const batch = await appendBatch(scene.id, author, ops, {});
      res.status(201).json(batch);
    } catch (e) {
      if (isAppendFailure(e)) {
        throw errors.validation({ [`ops[${e.opIndex}].${e.field}`]: e.message });
      }
      throw e;
    }
  } catch (e) {
    next(e);
  }
});

async function handleUndoRedo(req: Request, res: Response, isRedo: boolean): Promise<void> {
  const caller = req.caller!;
  const ws = await callerWorkspaceId(req);
  const scene = await getSceneRow(req.params.sceneId!, ws);
  if (!canEditScene(caller)) throw errors.forbidden();
  await assertNotReadOnly(ws);
  const author = callerAuthor(caller);
  const key = authorKey(author);

  if (!isRedo) {
    const target = await query(
      `SELECT batch_id FROM author_batches
       WHERE scene_id = $1 AND author_key = $2 AND undone = FALSE
       ORDER BY first_seq DESC LIMIT 1`,
      [scene.id, key],
    );
    const batchId = (target.rows[0] as { batch_id: string } | undefined)?.batch_id;
    if (!batchId) throw errors.conflict("nothing_to_undo");
    const rows = await query(
      "SELECT type, payload, inverse FROM ops WHERE scene_id = $1 AND batch_id = $2 ORDER BY seq",
      [scene.id, batchId],
    );
    const inverses = (rows.rows as { type: string; payload: Record<string, unknown>; inverse: { type: string; payload: Record<string, unknown> } }[])
      .map((r) => ({ type: r.inverse.type, payload: r.inverse.payload }))
      .reverse();
    try {
      const batch = await appendBatch(scene.id, author, inverses, { undoOf: batchId });
      res.status(201).json(batch);
    } catch (e) {
      if (isAppendFailure(e)) throw errors.conflict("undo_conflict", { nodeId: e.nodeId });
      throw e;
    }
    return;
  }

  const target = await query(
    `SELECT batch_id FROM author_batches
     WHERE scene_id = $1 AND author_key = $2 AND undone = TRUE AND redo_cleared = FALSE
     ORDER BY undone_by_seq DESC NULLS LAST LIMIT 1`,
    [scene.id, key],
  );
  const batchId = (target.rows[0] as { batch_id: string } | undefined)?.batch_id;
  if (!batchId) throw errors.conflict("nothing_to_redo");
  const rows = await query(
    "SELECT type, payload FROM ops WHERE scene_id = $1 AND batch_id = $2 ORDER BY seq",
    [scene.id, batchId],
  );
  const ops = (rows.rows as { type: string; payload: Record<string, unknown> }[]).map((r) => ({ type: r.type, payload: r.payload }));
  try {
    const batch = await appendBatch(scene.id, author, ops, { redoOf: batchId });
    res.status(201).json(batch);
  } catch (e) {
    if (isAppendFailure(e)) throw errors.conflict("undo_conflict", { nodeId: e.nodeId });
    throw e;
  }
}

scenesRouter.post("/:sceneId/undo", async (req, res, next) => {
  try {
    await handleUndoRedo(req, res, false);
  } catch (e) {
    next(e);
  }
});

scenesRouter.post("/:sceneId/redo", async (req, res, next) => {
  try {
    await handleUndoRedo(req, res, true);
  } catch (e) {
    next(e);
  }
});

scenesRouter.post("/:sceneId/restore", async (req, res, next) => {
  try {
    const caller = req.caller!;
    const ws = await callerWorkspaceId(req);
    const scene = await getSceneRow(req.params.sceneId, ws);
    if (!canEditScene(caller)) throw errors.forbidden();
    await assertNotReadOnly(ws);
    const toSeq = Number(req.body?.toSeq);
    const latest = await latestSeq(scene.id);
    if (!Number.isInteger(toSeq) || toSeq < 0 || toSeq >= latest) {
      throw errors.validation({ toSeq: "Out of range" });
    }
    const rows = await query(
      "SELECT inverse FROM ops WHERE scene_id = $1 AND seq > $2 ORDER BY seq DESC",
      [scene.id, toSeq],
    );
    const inverses = (rows.rows as { inverse: { type: string; payload: Record<string, unknown> } }[])
      .map((r) => ({ type: r.inverse.type, payload: r.inverse.payload }));
    const author = callerAuthor(caller);
    try {
      const batch = await appendBatch(scene.id, author, inverses, { restoreTo: toSeq });
      audit(caller, "scene.restored", { type: "scene", id: scene.id });
      res.status(201).json({ ...batch, restoredTo: toSeq });
    } catch (e) {
      if (isAppendFailure(e)) throw errors.conflict("undo_conflict", { nodeId: e.nodeId });
      throw e;
    }
  } catch (e) {
    next(e);
  }
});
