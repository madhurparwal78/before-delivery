import { createHash } from 'node:crypto';
import { PoolClient } from 'pg';
import { Author, BatchResultDto, LockDto, OpDto } from '../../shared/api';
import { Graph, canonicalGraphJson, cloneGraph } from '../../shared/graph';
import { OpError, RawOp, applyOp, lockedNodeOf, namedStateOf } from '../../shared/ops';
import { pool, query, transaction } from '../db/pool';
import { ApiError, fail } from '../http/errors';
import { publish, publishLock } from '../realtime/bus';
import { mirror } from '../services/pocketbase';
import { randomId } from '../util/crypto';
import { Caller, authorOf } from './permissions';
import { LOCK_TTL_SECONDS, toIso } from './time';

export interface SceneRow {
  id: string;
  workspace_id: string;
  name: string;
  base_graph: Graph;
  latest_seq: number;
  embed_id: string | null;
  created_at: Date;
  updated_at: Date;
}

interface OpRow {
  scene_id: string;
  seq: number;
  batch_id: string;
  type: string;
  payload: Record<string, unknown>;
  inverse: Record<string, unknown>;
  author_kind: 'member' | 'agent';
  author_id: string;
  author_name: string;
  created_at: Date;
  undo_of: string | null;
  redo_of: string | null;
  restore_to: number | null;
}

export function hashGraph(graph: Graph): string {
  return createHash('sha256').update(canonicalGraphJson(graph)).digest('hex');
}

export function opDto(row: OpRow): OpDto {
  return {
    seq: row.seq,
    batchId: row.batch_id,
    type: row.type,
    payload: row.payload,
    inverse: row.inverse,
    author: { kind: row.author_kind, id: row.author_id, name: row.author_name },
    createdAt: toIso(row.created_at),
    undoOf: row.undo_of,
    redoOf: row.redo_of,
    restoreTo: row.restore_to,
  };
}

export async function getScene(sceneId: string, workspaceId: string): Promise<SceneRow | null> {
  const rows = await query<SceneRow>(`SELECT * FROM scenes WHERE id = $1 AND workspace_id = $2`, [
    sceneId,
    workspaceId,
  ]);
  return rows[0] ?? null;
}

async function modelAssetIds(workspaceId: string, client?: PoolClient): Promise<Set<string>> {
  const runner = client ?? pool;
  const result = await runner.query<{ id: string }>(
    `SELECT id FROM assets WHERE workspace_id = $1 AND kind = 'model'`,
    [workspaceId],
  );
  return new Set(result.rows.map((row) => row.id));
}

async function loadOps(
  sceneId: string,
  upTo: number | null,
  client?: PoolClient,
): Promise<OpRow[]> {
  const runner = client ?? pool;
  const result = await runner.query<OpRow>(
    upTo === null
      ? `SELECT * FROM ops WHERE scene_id = $1 ORDER BY seq`
      : `SELECT * FROM ops WHERE scene_id = $1 AND seq <= $2 ORDER BY seq`,
    upTo === null ? [sceneId] : [sceneId, upTo],
  );
  return result.rows;
}

function replay(base: Graph, ops: OpRow[], assets: Set<string>): Graph {
  const graph = cloneGraph(base);
  ops.forEach((row, index) => {
    applyOp(graph, { type: row.type, payload: row.payload }, `ops[${index}]`, {
      modelAssetIds: assets,
    });
  });
  return graph;
}

/** Replays operations 0..seq into the graph as the server sees it. */
export async function graphAt(
  scene: SceneRow,
  seq: number,
  client?: PoolClient,
): Promise<Graph> {
  const assets = await modelAssetIds(scene.workspace_id, client);
  const ops = await loadOps(scene.id, seq, client);
  return replay(scene.base_graph, ops, assets);
}

export async function listOps(
  sceneId: string,
  after: number,
  limit: number,
): Promise<OpDto[]> {
  const rows = await query<OpRow>(
    `SELECT * FROM ops WHERE scene_id = $1 AND seq > $2 ORDER BY seq LIMIT $3`,
    [sceneId, after, limit],
  );
  return rows.map(opDto);
}

interface LockRow {
  scene_id: string;
  node_id: string;
  workspace_id: string;
  holder_kind: 'member' | 'agent';
  holder_id: string;
  holder_name: string;
  expires_at: Date;
}

function lockDto(row: LockRow): LockDto {
  return {
    nodeId: row.node_id,
    holder: { kind: row.holder_kind, id: row.holder_id, name: row.holder_name },
    expiresAt: toIso(row.expires_at),
  };
}

export async function listLocks(sceneId: string): Promise<LockDto[]> {
  const rows = await query<LockRow>(
    `SELECT * FROM object_locks WHERE scene_id = $1 AND expires_at > now() ORDER BY node_id`,
    [sceneId],
  );
  return rows.map(lockDto);
}

function lockConflict(nodeId: string, holder: Author): ApiError {
  return fail.conflict('locked', { nodeId, holder });
}

/**
 * Takes every free lock the batch needs. A node held by another author refuses
 * the whole batch, naming the first such node in batch order.
 */
const CLAIM_LOCK_SQL = `
  INSERT INTO object_locks (scene_id, node_id, workspace_id, holder_kind, holder_id, holder_name, expires_at)
  VALUES ($1, $2, $3, $4, $5, $6, now() + ($7 || ' seconds')::interval)
  ON CONFLICT (scene_id, node_id) DO UPDATE
    SET holder_kind = EXCLUDED.holder_kind,
        holder_id = EXCLUDED.holder_id,
        holder_name = EXCLUDED.holder_name,
        expires_at = EXCLUDED.expires_at
    WHERE object_locks.expires_at <= now()
       OR (object_locks.holder_kind = EXCLUDED.holder_kind
           AND object_locks.holder_id = EXCLUDED.holder_id)
  RETURNING *`;

/** One statement decides the winner, so simultaneous claims cannot both succeed. */
async function claimLockRow(
  client: Pick<PoolClient, 'query'>,
  scene: SceneRow,
  caller: Caller,
  nodeId: string,
): Promise<LockRow> {
  const author = authorOf(caller);
  const claimed = await client.query<LockRow>(CLAIM_LOCK_SQL, [
    scene.id,
    nodeId,
    scene.workspace_id,
    author.kind,
    author.id,
    author.name,
    LOCK_TTL_SECONDS,
  ]);
  const row = claimed.rows[0];
  if (row) return row;
  const current = await client.query<LockRow>(
    `SELECT * FROM object_locks WHERE scene_id = $1 AND node_id = $2`,
    [scene.id, nodeId],
  );
  const holder = current.rows[0];
  throw lockConflict(
    nodeId,
    holder
      ? { kind: holder.holder_kind, id: holder.holder_id, name: holder.holder_name }
      : { kind: 'member', id: 'unknown', name: 'another author' },
  );
}

async function takeLocks(
  client: PoolClient,
  scene: SceneRow,
  caller: Caller,
  nodeIds: string[],
): Promise<void> {
  for (const nodeId of nodeIds) {
    await claimLockRow(client, scene, caller, nodeId);
  }
}

function announceLocks(scene: SceneRow, caller: Caller, nodeIds: string[], expiresAt: string): void {
  const author = authorOf(caller);
  for (const nodeId of nodeIds) {
    publish(scene.id, { event: 'lock', data: { nodeId, holder: author } });
    mirror.lock({
      workspaceId: scene.workspace_id,
      sceneId: scene.id,
      nodeId,
      holderKind: author.kind,
      holderId: author.id,
      holderName: author.name,
      expiresAt,
    });
  }
}

export interface BatchMeta {
  undoOf?: string | null;
  redoOf?: string | null;
  restoreTo?: number | null;
}

interface AppliedBatch extends BatchResultDto {
  ops: OpDto[];
  lockedNodes: string[];
}

async function writeBatch(
  client: PoolClient,
  scene: SceneRow,
  caller: Caller,
  ops: RawOp[],
  meta: BatchMeta,
): Promise<AppliedBatch> {
  const author = authorOf(caller);
  const assets = await modelAssetIds(scene.workspace_id, client);
  const existingOps = await loadOps(scene.id, null, client);
  const graph = replay(scene.base_graph, existingOps, assets);

  const lockedNodes: string[] = [];
  for (const op of ops) {
    const nodeId = lockedNodeOf(op);
    if (nodeId !== null && !lockedNodes.includes(nodeId)) lockedNodes.push(nodeId);
  }
  await takeLocks(client, scene, caller, lockedNodes);

  const batchId = randomId('batch');
  const firstSeq = scene.latest_seq + 1;
  const written: OpDto[] = [];
  let seq = scene.latest_seq;
  for (const [index, op] of ops.entries()) {
    let inverse: RawOp;
    try {
      inverse = applyOp(graph, op, `ops[${index}]`, { modelAssetIds: assets });
    } catch (error) {
      if (error instanceof OpError) throw fail.validation(error.errors);
      throw error;
    }
    seq += 1;
    const inserted = await client.query<OpRow>(
      `INSERT INTO ops (scene_id, seq, batch_id, type, payload, inverse, author_kind, author_id, author_name, undo_of, redo_of, restore_to)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8, $9, $10, $11, $12)
       RETURNING *`,
      [
        scene.id,
        seq,
        batchId,
        op.type,
        JSON.stringify(op.payload),
        JSON.stringify(inverse),
        author.kind,
        author.id,
        author.name,
        meta.undoOf ?? null,
        meta.redoOf ?? null,
        meta.restoreTo ?? null,
      ],
    );
    written.push(opDto(inserted.rows[0] as OpRow));
  }
  await client.query(`UPDATE scenes SET latest_seq = $2, updated_at = now() WHERE id = $1`, [
    scene.id,
    seq,
  ]);
  return {
    batchId,
    firstSeq,
    lastSeq: seq,
    latestSeq: seq,
    hash: hashGraph(graph),
    ops: written,
    lockedNodes,
  };
}

function finishBatch(scene: SceneRow, caller: Caller, batch: AppliedBatch): BatchResultDto {
  publish(scene.id, { event: 'op', data: { batchId: batch.batchId, ops: batch.ops } });
  announceLocks(
    scene,
    caller,
    batch.lockedNodes,
    toIso(new Date(Date.now() + LOCK_TTL_SECONDS * 1000)),
  );
  return {
    batchId: batch.batchId,
    firstSeq: batch.firstSeq,
    lastSeq: batch.lastSeq,
    latestSeq: batch.latestSeq,
    hash: batch.hash,
  };
}

async function lockScene(client: PoolClient, sceneId: string, workspaceId: string): Promise<SceneRow> {
  const result = await client.query<SceneRow>(
    `SELECT * FROM scenes WHERE id = $1 AND workspace_id = $2 FOR UPDATE`,
    [sceneId, workspaceId],
  );
  const scene = result.rows[0];
  if (!scene) throw fail.notFound();
  return scene;
}

export async function applyBatch(
  caller: Caller,
  sceneId: string,
  ops: RawOp[],
): Promise<BatchResultDto> {
  const { scene, batch } = await transaction(async (client) => {
    const current = await lockScene(client, sceneId, caller.workspaceId);
    return { scene: current, batch: await writeBatch(client, current, caller, ops, {}) };
  });
  return finishBatch(scene, caller, batch);
}

interface AuthorBatch {
  batchId: string;
  ops: OpRow[];
  undoOf: string | null;
  redoOf: string | null;
}

function authorBatches(ops: OpRow[], author: Author): AuthorBatch[] {
  const batches = new Map<string, AuthorBatch>();
  for (const op of ops) {
    if (op.author_kind !== author.kind || op.author_id !== author.id) continue;
    const existing = batches.get(op.batch_id);
    if (existing) {
      existing.ops.push(op);
      continue;
    }
    batches.set(op.batch_id, {
      batchId: op.batch_id,
      ops: [op],
      undoOf: op.undo_of,
      redoOf: op.redo_of,
    });
  }
  return [...batches.values()];
}

interface UndoState {
  undoStack: AuthorBatch[];
  redoStack: AuthorBatch[];
}

/** Each author keeps their own undo and redo stacks, derived from the log. */
function undoState(ops: OpRow[], author: Author): UndoState {
  const batches = authorBatches(ops, author);
  const undoStack: AuthorBatch[] = [];
  const redoStack: AuthorBatch[] = [];
  for (const batch of batches) {
    if (batch.undoOf) {
      const index = undoStack.findIndex((entry) => entry.batchId === batch.undoOf);
      if (index >= 0) {
        const [undone] = undoStack.splice(index, 1);
        if (undone) redoStack.push(undone);
      }
      continue;
    }
    if (batch.redoOf) {
      const index = redoStack.findIndex((entry) => entry.batchId === batch.redoOf);
      if (index >= 0) redoStack.splice(index, 1);
      undoStack.push(batch);
      continue;
    }
    undoStack.push(batch);
    redoStack.length = 0;
  }
  return { undoStack, redoStack };
}

function inverseOps(batch: AuthorBatch): RawOp[] {
  return [...batch.ops]
    .sort((a, b) => b.seq - a.seq)
    .map((op) => ({ type: String(op.inverse.type), payload: op.inverse.payload as Record<string, unknown> }));
}

function replayOps(batch: AuthorBatch): RawOp[] {
  return [...batch.ops]
    .sort((a, b) => a.seq - b.seq)
    .map((op) => ({ type: op.type, payload: op.payload }));
}

function undoConflict(ops: RawOp[], errors: Record<string, string>): never {
  const path = Object.keys(errors)[0] ?? '';
  const match = /^ops\[(\d+)\]/.exec(path);
  const op = match ? ops[Number(match[1])] : undefined;
  const nodeId = op ? lockedNodeOf(op) : null;
  const stateId = op ? namedStateOf(op) : null;
  throw fail.conflict('undo_conflict', { nodeId, stateId });
}

export async function undoBatch(caller: Caller, sceneId: string): Promise<BatchResultDto> {
  const author = authorOf(caller);
  const { scene, batch } = await transaction(async (client) => {
    const current = await lockScene(client, sceneId, caller.workspaceId);
    const ops = await loadOps(current.id, null, client);
    const state = undoState(ops, author);
    const target = state.undoStack[state.undoStack.length - 1];
    if (!target) throw fail.conflict('nothing_to_undo');
    const inverses = inverseOps(target);
    try {
      return {
        scene: current,
        batch: await writeBatch(client, current, caller, inverses, { undoOf: target.batchId }),
      };
    } catch (error) {
      if (error instanceof ApiError && error.status === 422) {
        undoConflict(inverses, (error.body.errors ?? {}) as Record<string, string>);
      }
      throw error;
    }
  });
  return finishBatch(scene, caller, batch);
}

export async function redoBatch(caller: Caller, sceneId: string): Promise<BatchResultDto> {
  const author = authorOf(caller);
  const { scene, batch } = await transaction(async (client) => {
    const current = await lockScene(client, sceneId, caller.workspaceId);
    const ops = await loadOps(current.id, null, client);
    const state = undoState(ops, author);
    const target = state.redoStack[state.redoStack.length - 1];
    if (!target) throw fail.conflict('nothing_to_redo');
    const again = replayOps(target);
    try {
      return {
        scene: current,
        batch: await writeBatch(client, current, caller, again, { redoOf: target.batchId }),
      };
    } catch (error) {
      if (error instanceof ApiError && error.status === 422) {
        undoConflict(again, (error.body.errors ?? {}) as Record<string, string>);
      }
      throw error;
    }
  });
  return finishBatch(scene, caller, batch);
}

export async function restoreToSeq(
  caller: Caller,
  sceneId: string,
  toSeq: number,
): Promise<BatchResultDto & { restoredTo: number }> {
  const { scene, batch } = await transaction(async (client) => {
    const current = await lockScene(client, sceneId, caller.workspaceId);
    if (!Number.isInteger(toSeq) || toSeq < 0 || toSeq >= current.latest_seq) {
      throw fail.validation({ toSeq: `Must be between 0 and ${current.latest_seq - 1}` });
    }
    const ops = await loadOps(current.id, null, client);
    const inverses = ops
      .filter((op) => op.seq > toSeq)
      .sort((a, b) => b.seq - a.seq)
      .map((op) => ({
        type: String(op.inverse.type),
        payload: op.inverse.payload as Record<string, unknown>,
      }));
    return {
      scene: current,
      batch: await writeBatch(client, current, caller, inverses, { restoreTo: toSeq }),
    };
  });
  return { ...finishBatch(scene, caller, batch), restoredTo: toSeq };
}

export async function claimLock(
  caller: Caller,
  scene: SceneRow,
  nodeId: string,
): Promise<LockDto> {
  const author = authorOf(caller);
  const lock = lockDto(await claimLockRow(pool, scene, caller, nodeId));
  publish(scene.id, { event: 'lock', data: { nodeId, holder: author } });
  mirror.lock({
    workspaceId: scene.workspace_id,
    sceneId: scene.id,
    nodeId,
    holderKind: author.kind,
    holderId: author.id,
    holderName: author.name,
    expiresAt: lock.expiresAt,
  });
  return lock;
}

export async function releaseLock(caller: Caller, scene: SceneRow, nodeId: string): Promise<void> {
  const author = authorOf(caller);
  const result = await query<LockRow>(
    `DELETE FROM object_locks
     WHERE scene_id = $1 AND node_id = $2 AND holder_kind = $3 AND holder_id = $4
     RETURNING *`,
    [scene.id, nodeId, author.kind, author.id],
  );
  if (result.length === 0) throw fail.conflict('not_lock_holder');
  publishLock(scene.id, { nodeId });
  mirror.lockGone(scene.id, nodeId);
}

export async function takeoverLock(
  caller: Caller,
  scene: SceneRow,
  nodeId: string,
): Promise<{ lock: LockDto; previousHolder: Author | null }> {
  const author = authorOf(caller);
  const outcome = await transaction(async (client) => {
    const existing = await client.query<LockRow>(
      `SELECT * FROM object_locks WHERE scene_id = $1 AND node_id = $2 FOR UPDATE`,
      [scene.id, nodeId],
    );
    const held = existing.rows[0];
    const previousHolder: Author | null =
      held && held.expires_at.getTime() > Date.now()
        ? { kind: held.holder_kind, id: held.holder_id, name: held.holder_name }
        : null;
    const result = await client.query<LockRow>(
      `INSERT INTO object_locks (scene_id, node_id, workspace_id, holder_kind, holder_id, holder_name, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, now() + ($7 || ' seconds')::interval)
       ON CONFLICT (scene_id, node_id) DO UPDATE
         SET holder_kind = EXCLUDED.holder_kind,
             holder_id = EXCLUDED.holder_id,
             holder_name = EXCLUDED.holder_name,
             expires_at = EXCLUDED.expires_at
       RETURNING *`,
      [scene.id, nodeId, scene.workspace_id, author.kind, author.id, author.name, LOCK_TTL_SECONDS],
    );
    return {
      lock: lockDto(result.rows[0] as LockRow),
      previousHolder:
        previousHolder && previousHolder.id === author.id ? null : previousHolder,
    };
  });
  publish(scene.id, { event: 'lock', data: { nodeId, holder: author } });
  mirror.lock({
    workspaceId: scene.workspace_id,
    sceneId: scene.id,
    nodeId,
    holderKind: author.kind,
    holderId: author.id,
    holderName: author.name,
    expiresAt: outcome.lock.expiresAt,
  });
  return outcome;
}

/** A heartbeat keeps the author's locks from lapsing. */
export async function refreshHolderLocks(scene: SceneRow, author: Author): Promise<void> {
  await query(
    `UPDATE object_locks
     SET expires_at = now() + ($4 || ' seconds')::interval
     WHERE scene_id = $1 AND holder_kind = $2 AND holder_id = $3`,
    [scene.id, author.kind, author.id, LOCK_TTL_SECONDS],
  );
}

export async function releaseAllLocksOf(
  workspaceId: string,
  holderId: string,
  client?: PoolClient,
): Promise<void> {
  const runner = client ?? pool;
  const result = await runner.query<LockRow>(
    `DELETE FROM object_locks WHERE workspace_id = $1 AND holder_id = $2 RETURNING *`,
    [workspaceId, holderId],
  );
  for (const row of result.rows) {
    publishLock(row.scene_id, { nodeId: row.node_id });
    mirror.lockGone(row.scene_id, row.node_id);
  }
  await runner.query(`DELETE FROM presence WHERE author_id = $1`, [holderId]);
}
