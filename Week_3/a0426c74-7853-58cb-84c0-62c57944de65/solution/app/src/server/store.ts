// All the SQL for a drawing's records: the drawing row, its entities and the operation log.
import { stateFromDocument, type Change, type TargetKind } from '../shared/model/index.ts';
import type {
  BlockDef, Constraint, DimStyle, DrawingState, Entity, Layer, LayerState, OpResult, Op, Parameter, StatePatch, Underlay, Xref,
} from '../shared/types.ts';
import type { Queryable } from './db.ts';
import { db } from './db.ts';

const ENTITY_CHUNK = 2000;

/** The patch fields that replace a whole collection, and the drawing column each is kept in. */
const COLLECTION_COLUMNS = ['layers', 'blocks', 'dim_styles', 'parameters', 'constraints', 'xrefs', 'layer_states', 'underlays'] as const;

interface DrawingRow {
  folder_id: string; name: string; revision: number; next_handle: number;
  layers: Layer[]; blocks: BlockDef[]; dim_styles: DimStyle[]; parameters: Parameter[]; constraints: Constraint[];
  xrefs: Xref[]; layer_states: LayerState[]; underlays: Underlay[];
}

const sourcesOf = (xrefs: readonly Xref[]): string[] => [...new Set(xrefs.map((xref) => xref.source))];

async function upsertEntities(q: Queryable, drawingId: string, entities: readonly Entity[]): Promise<void> {
  for (let from = 0; from < entities.length; from += ENTITY_CHUNK) {
    await q.query(
      `INSERT INTO entities (drawing_id, handle, data)
       SELECT $1, e->>'handle', e FROM jsonb_array_elements($2::jsonb) AS e
       ON CONFLICT (drawing_id, handle) DO UPDATE SET data = EXCLUDED.data`,
      [drawingId, JSON.stringify(entities.slice(from, from + ENTITY_CHUNK))],
    );
  }
}

/** Writes a new drawing with the whole of its starting state. */
export async function insertDrawing(q: Queryable, id: string, folderId: string, name: string, state: DrawingState): Promise<void> {
  const xrefs = Object.values(state.xrefs);
  await q.query(
    `INSERT INTO drawings (id, folder_id, name, revision, next_handle, layers, blocks, dim_styles, parameters, constraints, xrefs,
       layer_states, underlays, xref_sources)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
    [
      id, folderId, name, state.revision, state.next_handle, JSON.stringify(Object.values(state.layers)),
      JSON.stringify(Object.values(state.blocks)), JSON.stringify(Object.values(state.dim_styles)),
      JSON.stringify(Object.values(state.parameters)), JSON.stringify(state.constraints), JSON.stringify(xrefs),
      JSON.stringify(Object.values(state.layer_states)), JSON.stringify(state.underlays), sourcesOf(xrefs),
    ],
  );
  await upsertEntities(q, id, Object.values(state.entities));
}

/** One applied group as it is logged. */
export interface LoggedGroup {
  revision: number; baseRevision: number; groupId: string; username: string; command: string; at: Date;
  ops: Op[]; results: OpResult[]; changes: Change[];
}

/** Appends the group to the operation log with its op ids and what it touched. */
export async function logGroup(q: Queryable, drawingId: string, group: LoggedGroup): Promise<void> {
  await q.query(
    `INSERT INTO op_groups (drawing_id, revision, base_revision, group_id, username, command, at, ops, results, changes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [drawingId, group.revision, group.baseRevision, group.groupId, group.username, group.command, group.at,
      JSON.stringify(group.ops), JSON.stringify(group.results), JSON.stringify(group.changes)],
  );
  if (group.ops.length > 0) {
    await q.query(
      'INSERT INTO op_ids (drawing_id, op_id, revision) SELECT $1, op_id, $3 FROM unnest($2::text[]) AS op_id',
      [drawingId, group.ops.map((op) => op.op_id), group.revision],
    );
  }
  if (group.changes.length > 0) {
    await q.query(
      `INSERT INTO group_targets (drawing_id, kind, key, revision, derived)
       SELECT $1, kind, key, $4, derived FROM unnest($2::text[], $3::text[], $5::boolean[]) AS t(kind, key, derived)`,
      [drawingId, group.changes.map((c) => c.kind), group.changes.map((c) => c.key), group.revision, group.changes.map((c) => c.derived)],
    );
  }
}

/** Applies the patch of a group to the drawing's records: changed entities, the collections it replaced, revision and next handle. */
export async function writePatch(q: Queryable, drawingId: string, patch: StatePatch): Promise<void> {
  await upsertEntities(q, drawingId, patch.entities_upsert);
  if (patch.entities_delete.length > 0) {
    await q.query('DELETE FROM entities WHERE drawing_id = $1 AND handle = ANY($2::text[])', [drawingId, patch.entities_delete]);
  }
  const sets = ['revision = $2', 'next_handle = $3'];
  const params: unknown[] = [drawingId, patch.revision, patch.next_handle];
  for (const column of COLLECTION_COLUMNS) {
    const value = patch[column];
    if (value === undefined) continue;
    params.push(JSON.stringify(value));
    sets.push(`${column} = $${params.length}`);
  }
  if (patch.xrefs) {
    params.push(sourcesOf(patch.xrefs));
    sets.push(`xref_sources = $${params.length}`);
  }
  await q.query(`UPDATE drawings SET ${sets.join(', ')} WHERE id = $1`, params);
}

export interface StoredDrawing { folderId: string; name: string; state: DrawingState }

/** A drawing's records, or null when there is none with that id. */
export async function readDrawing(id: string): Promise<StoredDrawing | null> {
  const rows = await db.query<DrawingRow>(
    `SELECT folder_id, name, revision, next_handle, layers, blocks, dim_styles, parameters, constraints, xrefs, layer_states, underlays
       FROM drawings WHERE id = $1`,
    [id],
  );
  if (rows.length === 0) return null;
  const entities = await db.query<{ data: Entity }>('SELECT data FROM entities WHERE drawing_id = $1', [id]);
  const { folder_id: folderId, name, parameters, ...collections } = rows[0];
  // a parameter's value is derived; the engine computes it again whenever it is asked for
  const parameterViews = parameters.map((parameter) => ({ ...parameter, value: null }));
  return { folderId, name, state: stateFromDocument({ ...collections, parameters: parameterViews, entities: entities.map((row) => row.data) }) };
}

export interface StoredTouch { kind: TargetKind; key: string; revision: number; derived: boolean; username: string }

/** Everything the drawing's changes touched, with who touched it. */
export function readTouches(drawingId: string): Promise<StoredTouch[]> {
  return db.query<StoredTouch>(
    `SELECT t.kind, t.key, t.revision, t.derived, g.username FROM group_targets t
       JOIN op_groups g ON g.drawing_id = t.drawing_id AND g.revision = t.revision
      WHERE t.drawing_id = $1 ORDER BY t.revision`,
    [drawingId],
  );
}

/** The changes of the groups logged after `revision` (the window in which an entity may still be asked for as it was). */
export async function readChangesAfter(drawingId: string, revision: number): Promise<Array<{ revision: number; changes: Change[] }>> {
  return db.query('SELECT revision, changes FROM op_groups WHERE drawing_id = $1 AND revision > $2 ORDER BY revision', [drawingId, revision]);
}

/** The stored response of the group that holds any of these op ids (a replay), else null. */
export async function findReplay(drawingId: string, opIds: readonly string[]): Promise<{ revision: number; results: OpResult[] } | null> {
  const rows = await db.query<{ revision: number; results: OpResult[] }>(
    `SELECT g.revision, g.results FROM op_ids o JOIN op_groups g ON g.drawing_id = o.drawing_id AND g.revision = o.revision
      WHERE o.drawing_id = $1 AND o.op_id = ANY($2::text[]) LIMIT 1`,
    [drawingId, [...opIds]],
  );
  return rows[0] ?? null;
}
