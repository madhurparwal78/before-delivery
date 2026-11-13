import { ApiError, ERROR_TEXT } from '../shared/errors.js';
import type { Entity, Pt } from '../shared/geometry.js';
import { createEmptyModel, type DrawingModel, type LayerRecord } from '../shared/model.js';
import { DrawingEngine, handleNumber, type StoredOperation } from './engine.js';

import { pool } from './db.js';
import { formatUtc, randomId } from '../shared/num.js';

// ---------------------------------------------------------------------------
// Drawing persistence: model snapshots, the operation log, undo/redo stacks.
// ---------------------------------------------------------------------------

export interface DrawingRow {
  id: string;
  folder_id: string;
  name: string;
  revision: number;
  next_handle: number;
  created_by: string;
}

export interface LoadedDrawing {
  row: DrawingRow;
  engine: DrawingEngine;
}

export async function loadDrawing(drawingId: string): Promise<LoadedDrawing | null> {
  const result = await pool.query<DrawingRow & { model: DrawingModel | null }>(
    'SELECT d.id, d.folder_id, d.name, d.revision, d.next_handle, d.created_by, m.model FROM drawings d LEFT JOIN drawing_model m ON m.drawing_id = d.id WHERE d.id = $1',
    [drawingId],
  );
  const row = result.rows[0];
  if (!row) return null;
  const engine = new DrawingEngine(row.model ?? createEmptyModel(), row.next_handle);
  const history = await pool.query<{ handle: string; username: string }>(
    'SELECT handle, username FROM entity_history WHERE drawing_id = $1 ORDER BY revision ASC, at ASC',
    [drawingId],
  );
  for (const entry of history.rows) {
    engine.noteAuthor(entry.handle, entry.username);
  }
  engine.refreshAssociations();
  return { row: { id: row.id, folder_id: row.folder_id, name: row.name, revision: row.revision, next_handle: row.next_handle, created_by: row.created_by }, engine };
}

export async function saveModel(drawingId: string, engine: DrawingEngine, revision: number): Promise<void> {
  await pool.query(
    `INSERT INTO drawing_model (drawing_id, model) VALUES ($1, $2)
     ON CONFLICT (drawing_id) DO UPDATE SET model = $2`,
    [drawingId, JSON.stringify(engine.model)],
  );
  await pool.query('UPDATE drawings SET revision = $2, next_handle = $3 WHERE id = $1', [drawingId, revision, engine.nextHandle]);
}

export interface ApplyGroupInput {
  drawingId: string;
  username: string;
  command: string;
  groupId: string;
  baseRevision: number;
  ops: StoredOperation[];
}

export interface AppliedGroup {
  revision: number;
  results: Array<{ op_id: string; status: 'applied' | 'rebased' | 'dropped' | 'redirected'; handles: string[]; message: string | null }>;
  notices: Array<{ text: string; recipient: string }>;
  command: string;
  groupId: string;
  author: string;
}

export async function findOpResult(drawingId: string, opIds: string[]): Promise<Map<string, unknown>> {
  const found = new Map<string, unknown>();
  for (const opId of opIds) {
    const result = await pool.query<{ result: unknown }>(
      'SELECT result FROM operations WHERE drawing_id = $1 AND op_id = $2 ORDER BY revision ASC LIMIT 1',
      [drawingId, opId],
    );
    if (result.rows[0]) found.set(opId, result.rows[0].result);
  }
  return found;
}

export async function applyGroup(input: ApplyGroupInput, config: { opWindow: number; opRate: number; undoDepth: number; now: Date }): Promise<AppliedGroup> {
  const loaded = await loadDrawing(input.drawingId);
  if (!loaded) throw new ApiError('not_found', 'We couldn\u2019t find that drawing.');
  const { engine, row } = loaded;
  if (input.baseRevision < row.revision - config.opWindow) {
    throw new ApiError('stale_base', ERROR_TEXT.staleBase);
  }
  const replayed: Array<{ op_id: string; status: 'applied'; handles: string[]; message: null }> = [];
  const fresh: StoredOperation[] = [];
  const previousResults = await findOpResult(input.drawingId, input.ops.map((op) => String(op.op_id)));
  for (const op of input.ops) {
    const opId = String(op.op_id);
    if (previousResults.has(opId)) {
      const stored = previousResults.get(opId) as { op_id: string; status: 'applied'; handles: string[]; message: null };
      replayed.push({ op_id: opId, status: 'applied', handles: stored.handles ?? [], message: null });
    } else {
      fresh.push(op);
    }
  }
  if (!fresh.length) {
    return {
      revision: row.revision,
      results: replayed,
      notices: [],
      command: input.command,
      groupId: input.groupId,
      author: input.username,
    };
  }
  const restoreOp = fresh.find((op) => op.type === 'version_restore');
  if (restoreOp) {
    const versionId = String((restoreOp as Record<string, unknown>).version ?? '');
    const snapshotRow = await pool.query<{ snapshot: unknown }>('SELECT snapshot FROM sheet_versions WHERE id = $1 AND drawing_id = $2', [versionId, input.drawingId]);
    const snapshot = snapshotRow.rows[0]?.snapshot as { model?: { entities?: Record<string, Entity>; order?: string[] } } | undefined;
    if (snapshot?.model?.entities) {
      engine.setRestoreSnapshot({ entities: snapshot.model.entities, order: snapshot.model.order ?? Object.keys(snapshot.model.entities) });
    }
  }
  const before = deepCloneModel(engine.model);
  let results: Array<{ op_id: string; status: 'applied' | 'rebased' | 'dropped' | 'redirected'; handles: string[]; message: string | null }> = [];
  const notices: Array<{ text: string; recipient: string }> = [];
  try {
    const applied = engine.applyGroup(fresh, {
      author: input.username,
      command: input.command,
      baseRevision: input.baseRevision,
      groupId: input.groupId,
      now: config.now,
    });
    results = applied.results;
    notices.push(...applied.notes);
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    throw error;
  }
  engine.refreshAssociations();
  const revision = row.revision + 1;
  await saveModel(input.drawingId, engine, revision);
  for (let i = 0; i < fresh.length; i++) {
    const op = fresh[i];
    await pool.query(
      'INSERT INTO operations (drawing_id, op_id, group_id, command, author, base_revision, revision, payload, result, at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
      [
        input.drawingId,
        String(op.op_id),
        input.groupId,
        input.command,
        input.username,
        input.baseRevision,
        revision,
        JSON.stringify(op),
        JSON.stringify(results[i]),
        config.now,
      ],
    );
  }
  const operationTime = config.now.getTime();
  const rateWindow = new Date(operationTime - 60000);
  const rate = await pool.query<{ count: string }>('SELECT count(*)::text AS count FROM op_rate WHERE username = $1 AND at > $2', [input.username, rateWindow]);
  if (Number(rate.rows[0]?.count ?? 0) + fresh.length > config.opRate) {
    throw new ApiError('rate_limited', 'Too many changes. Wait a moment and try again.');
  }
  await pool.query('INSERT INTO op_rate (username, at) VALUES ($1, $2)', [input.username, new Date(operationTime)]);
  for (const entry of engine.history) {
    await pool.query(
      'INSERT INTO entity_history (drawing_id, handle, revision, username, command, at) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING',
      [input.drawingId, entry.handle, revision, entry.username, entry.command, config.now],
    );
  }
  engine.history.length = 0;
  await pushUndo(input.drawingId, input.username, input.command, input.groupId, before, afterSnapshot(engine), config.undoDepth, config.now);
  return {
    revision,
    results: [...replayed, ...results],
    notices,
    command: input.command,
    groupId: input.groupId,
    author: input.username,
  };
}

export interface Snapshot {
  layers: Record<string, LayerRecord>;
  entities: Record<string, Entity>;
  order: string[];
  blocks: DrawingModel['blocks'];
  dim_styles: DrawingModel['dim_styles'];
  parameters: DrawingModel['parameters'];
  constraints: DrawingModel['constraints'];
  xrefs: DrawingModel['xrefs'];
  layer_states: DrawingModel['layer_states'];
  current_layer: string;
}

function snapshotOf(model: DrawingModel): Snapshot {
  return {
    layers: structuredClone(model.layers),
    entities: structuredClone(model.entities),
    order: [...model.order],
    blocks: structuredClone(model.blocks),
    dim_styles: structuredClone(model.dim_styles),
    parameters: structuredClone(model.parameters),
    constraints: structuredClone(model.constraints),
    xrefs: structuredClone(model.xrefs),
    layer_states: structuredClone(model.layer_states),
    current_layer: model.current_layer,
  };
}

function deepCloneModel(model: DrawingModel): Snapshot {
  return snapshotOf(model);
}

function afterSnapshot(engine: DrawingEngine): Snapshot {
  return snapshotOf(engine.model);
}

async function pushUndo(
  drawingId: string,
  username: string,
  command: string,
  groupId: string,
  before: Snapshot,
  after: Snapshot,
  depth: number,
  now: Date,
): Promise<void> {
  const payload = { before, after, command, groupId };
  await pool.query('INSERT INTO undo_stack (drawing_id, username, kind, group_id, command, payload, at) VALUES ($1,$2,$3,$4,$5,$6,$7)', [
    drawingId,
    username,
    'undo',
    groupId,
    command,
    JSON.stringify(payload),
    now,
  ]);
  await pool.query('DELETE FROM undo_stack WHERE drawing_id = $1 AND username = $2 AND kind = $3', [drawingId, username, 'redo']);
  const excess = await pool.query<{ id: string }>(
    `SELECT id FROM (SELECT id, ROW_NUMBER() OVER (ORDER BY at DESC, id DESC) AS rn FROM undo_stack WHERE drawing_id = $1 AND username = $2 AND kind = 'undo') ranked WHERE rn > $3`,
    [drawingId, username, depth],
  );
  for (const row of excess.rows) {
    await pool.query('DELETE FROM undo_stack WHERE id = $1', [row.id]);
  }
}

export interface UndoRow {
  id: string;
  payload: unknown;
  command: string;
  group_id: string;
  at: Date;
}

export async function listUndo(drawingId: string, username: string, kind: 'undo' | 'redo'): Promise<UndoRow[]> {
  const result = await pool.query<UndoRow>(
    'SELECT id, payload, command, group_id, at FROM undo_stack WHERE drawing_id = $1 AND username = $2 AND kind = $3 ORDER BY at DESC, id DESC',
    [drawingId, username, kind],
  );
  return result.rows;
}

export interface TopUndo {
  payload: unknown;
  command: string;
  group_id: string;
  at: Date;
}

export async function takeTopUndo(drawingId: string, username: string, kind: 'undo' | 'redo'): Promise<TopUndo | null> {
  const rows = await listUndo(drawingId, username, kind);
  return rows[0] ? { payload: rows[0].payload, command: rows[0].command, group_id: rows[0].group_id, at: rows[0].at } : null;
}

export async function removeUndoRow(drawingId: string, username: string, kind: 'undo' | 'redo', groupId: string): Promise<void> {
  await pool.query('DELETE FROM undo_stack WHERE drawing_id = $1 AND username = $2 AND kind = $3 AND group_id = $4', [drawingId, username, kind, groupId]);
}

export async function hasOthersChangedSince(drawingId: string, username: string, since: Date): Promise<string | null> {
  const result = await pool.query<{ author: string }>(
    'SELECT author FROM operations WHERE drawing_id = $1 AND author <> $2 AND at > $3 ORDER BY revision DESC LIMIT 1',
    [drawingId, username, since],
  );
  return result.rows[0]?.author ?? null;
}

export function randomGroupId(): string {
  return randomId('g');
}

export function formatStamp(date: Date): string {
  return formatUtc(date);
}
