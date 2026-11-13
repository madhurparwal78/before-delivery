import { pool } from './db.js';
import { DrawingEngine } from './engine.js';
import { liveHub } from './live.js';
import type { DrawingModel } from '../shared/model.js';
import type { Entity } from '../shared/geometry.js';
import { ApiError } from '../shared/errors.js';
import { loadDrawing, saveModel } from './ops.js';

// The server clock: real time plus the grading offset. Deadlines apply here.
let cachedOffset = 0;

export function offsetNow(): Date {
  return new Date(Date.now() + cachedOffset);
}

export async function loadOffset(): Promise<void> {
  const result = await pool.query<{ offset_ms: string }>('SELECT offset_ms::text AS offset_ms FROM grading_clock WHERE id = 1');
  cachedOffset = Number(result.rows[0]?.offset_ms ?? 0);
}

export async function advanceClock(ms: number): Promise<Date> {
  await pool.query('UPDATE grading_clock SET offset_ms = offset_ms + $1 WHERE id = 1', [ms]);
  await loadOffset();
  return offsetNow();
}

// Deadlines that pass apply at once and are broadcast.
export async function applyDeadlines(now: Date): Promise<void> {
  const expiredSteps = await pool.query<{ version_id: string; drawing_id: string; number: string }>(
    `SELECT r.version_id, v.drawing_id, v.number::text AS number FROM review_steps r
     JOIN sheet_versions v ON v.id = r.version_id
     WHERE r.state = 'pending' AND r.due_at IS NOT NULL AND r.due_at < $1`,
    [now],
  );
  for (const step of expiredSteps.rows) {
    await pool.query("UPDATE review_steps SET state = 'expired' WHERE version_id = $1 AND state = 'pending'", [step.version_id]);
    await pool.query("UPDATE review_steps SET state = 'expired' WHERE version_id = $1 AND step = 'manage'", [step.version_id]);
    const version = await pool.query<{ state: string }>('SELECT state FROM sheet_versions WHERE id = $1', [step.version_id]);
    if (version.rows[0]?.state === 'in_review') {
      await pool.query("UPDATE sheet_versions SET state = 'published' WHERE id = $1", [step.version_id]);
    }
    liveHub.broadcast(step.drawing_id, 'review', {
      version_id: step.version_id,
      number: Number(step.number),
      state: 'published',
      expired: true,
      steps: [],
    });
  }
}

export function drawingToSnapshot(model: DrawingModel): { layers: DrawingModel['layers']; entities: Record<string, Entity>; order: string[]; blocks: DrawingModel['blocks']; xrefs: DrawingModel['xrefs'] } {
  return {
    layers: model.layers,
    entities: model.entities,
    order: model.order,
    blocks: model.blocks,
    xrefs: model.xrefs,
  };
}

export async function restoreVersion(drawingId: string, versionId: string, username: string): Promise<void> {
  const version = await pool.query<{ snapshot: { model: { entities: Record<string, Entity>; order: string[] } } }>(
    'SELECT snapshot FROM sheet_versions WHERE id = $1 AND drawing_id = $2',
    [versionId, drawingId],
  );
  const snapshot = version.rows[0]?.snapshot;
  if (!snapshot) throw new ApiError('not_found', 'We couldn\u2019t find that version.');
  const loaded = await loadDrawing(drawingId);
  if (!loaded) throw new ApiError('not_found', 'We couldn\u2019t find that drawing.');
  const restored = structuredClone(snapshot.model);
  const model: DrawingModel = { ...loaded.engine.model, entities: restored.entities, order: restored.order };
  const engine = new DrawingEngine(model, loaded.engine.nextHandle);
  engine.refreshAssociations();
  const revision = loaded.row.revision + 1;
  await saveModel(drawingId, engine, revision);
  liveHub.broadcast(drawingId, 'ops', {
    revision,
    group_id: `g${Math.random().toString(36).slice(2, 11)}`,
    command: 'RESTORE',
    author: username,
    results: [{ op_id: '', status: 'applied', handles: [], message: null }],
    ops: [],
  });
}
