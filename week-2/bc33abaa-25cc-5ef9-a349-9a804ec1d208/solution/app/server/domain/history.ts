// The append-only operation log: batches applied whole or not at all, per-author undo and redo, and restore.
import { randomUUID } from "node:crypto";
import type { Author, BatchResult, Op } from "../../shared/api-types.js";
import { isoSecond } from "../../shared/format.js";
import { applyOperation, graphHash, lockTargets, parseOperation, type ApplyFailure, type Graph, type Operation } from "../../shared/graph.js";
import { undoStacks, type BatchMark } from "../../shared/undo.js";
import { one, pool, rows, transaction, type Db } from "../db.js";
import { HttpError, conflict, invalid, notFound } from "../errors.js";
import { announce } from "../events.js";
import { claimAll, refreshLocks, releaseAll } from "./locks.js";

export interface SceneRow {
  id: string; workspace_id: string; name: string; base_graph: Graph; graph: Graph; latest_seq: number;
  embed_id: string | null; created_at: Date; updated_at: Date;
}

export interface OpRow {
  scene_id: string; seq: number; batch_id: string; type: Operation["type"]; payload: Operation["payload"]; inverse: Operation;
  author_kind: Author["kind"]; author_id: string; author_name: string; created_at: Date;
  undo_of: string | null; redo_of: string | null; restore_to: number | null;
}

export async function loadScene(db: Db, workspaceId: string, sceneId: string): Promise<SceneRow> {
  const scene = await one<SceneRow>(db, "SELECT * FROM scenes WHERE id = $1 AND workspace_id = $2", [sceneId, workspaceId]);
  if (!scene) throw notFound();
  return scene;
}

export function opRowToOp(row: OpRow): Op {
  return {
    seq: row.seq, batchId: row.batch_id, type: row.type, payload: row.payload, inverse: row.inverse,
    author: { kind: row.author_kind, id: row.author_id, name: row.author_name }, createdAt: isoSecond(row.created_at),
    undoOf: row.undo_of, redoOf: row.redo_of, restoreTo: row.restore_to,
  };
}

/** Reads an operation back from the log through the same shape check every new operation passes. */
function stored(value: unknown): Operation {
  const op = parseOperation(value, "stored", {});
  if (!op) throw new Error("The operation log holds an operation that no longer parses");
  return op;
}

export async function graphAt(scene: SceneRow, seq: number): Promise<Graph> {
  const graph = structuredClone(scene.base_graph);
  const log = await rows<Pick<OpRow, "type" | "payload">>(pool, "SELECT type, payload FROM ops WHERE scene_id = $1 AND seq <= $2 ORDER BY seq", [scene.id, seq]);
  for (const row of log) applyOperation(graph, stored({ type: row.type, payload: row.payload }));
  return graph;
}

type Marks = { undoOf?: string; redoOf?: string; restoreTo?: number };

/** Applies a batch: claims its locks, applies every operation with its inverse, appends the rows, or changes nothing. */
async function commit(scene: SceneRow, author: Author, ops: Operation[], marks: Marks, refuse: (failure: ApplyFailure) => HttpError): Promise<BatchResult> {
  const taken = await claimAll(scene.workspace_id, scene.id, lockTargets(scene.graph, ops), author);
  const batchId = `b_${randomUUID().replace(/-/g, "")}`;
  let result: BatchResult;
  try {
    result = await transaction(async (client) => {
      const [current] = await rows<Pick<SceneRow, "graph" | "latest_seq">>(client, "SELECT graph, latest_seq FROM scenes WHERE id = $1 FOR UPDATE", [scene.id]);
      const graph = current.graph;
      const now = new Date();
      for (const [i, op] of ops.entries()) {
        const applied = applyOperation(graph, op, `ops[${i}].payload`);
        if (!applied.ok) throw refuse(applied);
        await client.query(
          `INSERT INTO ops (scene_id, seq, batch_id, type, payload, inverse, author_kind, author_id, author_name, created_at, undo_of, redo_of, restore_to)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
          [scene.id, current.latest_seq + i + 1, batchId, op.type, JSON.stringify(op.payload), JSON.stringify(applied.inverse),
            author.kind, author.id, author.name, now, marks.undoOf ?? null, marks.redoOf ?? null, marks.restoreTo ?? null]);
      }
      const latestSeq = current.latest_seq + ops.length;
      await client.query("UPDATE scenes SET graph = $2, latest_seq = $3, updated_at = $4 WHERE id = $1", [scene.id, JSON.stringify(graph), latestSeq, now]);
      return { batchId, firstSeq: current.latest_seq + 1, lastSeq: latestSeq, latestSeq, hash: graphHash(graph) };
    });
  } catch (error) {
    await releaseAll(scene.id, taken, author);
    throw error;
  }
  const added = ops.flatMap((op) => (op.type === "node.add" ? [op.payload.node.id] : []));
  if (added.length > 0) await claimAll(scene.workspace_id, scene.id, added, author);
  await refreshLocks(scene.id, author);
  await announce(scene.id, "op", { batchId });
  return result;
}

export function applyBatch(scene: SceneRow, author: Author, ops: Operation[]): Promise<BatchResult> {
  return commit(scene, author, ops, {}, (f) => invalid({ [f.path]: f.message }));
}

const undoConflict = (f: ApplyFailure) => conflict("undo_conflict", { nodeId: f.nodeId });

async function stacks(scene: SceneRow, author: Author): Promise<{ undo: string[]; redo: string[] }> {
  const batches = await rows<BatchMark>(pool,
    `SELECT batch_id AS "batchId", min(undo_of) AS "undoOf", min(redo_of) AS "redoOf" FROM ops
     WHERE scene_id = $1 AND author_kind = $2 AND author_id = $3 GROUP BY batch_id ORDER BY min(seq)`,
    [scene.id, author.kind, author.id]);
  return undoStacks(batches);
}

async function batchOps(scene: SceneRow, batchId: string): Promise<OpRow[]> {
  return rows<OpRow>(pool, "SELECT * FROM ops WHERE scene_id = $1 AND batch_id = $2 ORDER BY seq", [scene.id, batchId]);
}

export async function undo(scene: SceneRow, author: Author): Promise<BatchResult> {
  const target = (await stacks(scene, author)).undo.at(-1);
  if (!target) throw conflict("nothing_to_undo");
  const inverses = (await batchOps(scene, target)).reverse().map((row) => stored(row.inverse));
  return commit(scene, author, inverses, { undoOf: target }, undoConflict);
}

export async function redo(scene: SceneRow, author: Author): Promise<BatchResult> {
  const target = (await stacks(scene, author)).redo.at(-1);
  if (!target) throw conflict("nothing_to_redo");
  const forward = (await batchOps(scene, target)).map((row) => stored({ type: row.type, payload: row.payload }));
  return commit(scene, author, forward, { redoOf: target }, undoConflict);
}

/** Appends the inverses of every operation after toSeq, newest first, so the scene hashes as it did at toSeq. */
export async function restore(scene: SceneRow, author: Author, toSeq: number): Promise<BatchResult> {
  const later = await rows<OpRow>(pool, "SELECT * FROM ops WHERE scene_id = $1 AND seq > $2 ORDER BY seq DESC", [scene.id, toSeq]);
  return commit(scene, author, later.map((row) => stored(row.inverse)), { restoreTo: toSeq }, undoConflict);
}
