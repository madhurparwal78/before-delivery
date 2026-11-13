/** Per-person undo history: each step keeps the row images before and after, so undo restores rows exactly. */
import { findScene, sceneFieldsOf, type Patch, type Touched } from '../shared/document';
import type { Layer, Preset, SceneDocument, SceneFields, Variable } from '../shared/types';
import { config } from './config';
import { query, type Queryable } from './db';

interface Image {
  layers: { sceneId: string; layerId: string; idx: number | null; layer: Layer | null }[];
  scenes: SceneFields[];
  variables: Variable[] | null;
  presets: Preset[] | null;
}

/** The state of everything `touched` names, in `document`. `idx` gives the layers' stored array positions. */
export function captureImage(document: SceneDocument, idx: ReadonlyMap<string, number>, touched: Touched): Image {
  const layers: Image['layers'] = [];
  const ids = new Map<string, string>([...touched.layers, ...touched.removed]);
  for (const [layerId, sceneId] of ids) {
    const layer = findScene(document, sceneId)?.layers.find((l) => l.id === layerId) ?? null;
    layers.push({ sceneId, layerId, idx: idx.get(layerId) ?? null, layer: layer ? structuredClone(layer) : null });
  }
  return {
    layers,
    scenes: [...touched.scenes].flatMap((id) => {
      const scene = findScene(document, id);
      return scene ? [sceneFieldsOf(scene)] : [];
    }),
    variables: touched.variables ? structuredClone(document.variables) : null,
    presets: touched.presets ? structuredClone(document.presets) : null,
  };
}

export function patchOfImage(image: Image): Patch {
  return {
    scenes: image.scenes,
    layers: image.layers.flatMap((entry) => (entry.layer ? [{ sceneId: entry.sceneId, layer: entry.layer }] : [])),
    removed: image.layers.filter((entry) => entry.layer === null).map((entry) => ({ sceneId: entry.sceneId, layerId: entry.layerId })),
    variables: image.variables,
    presets: image.presets,
  };
}

export const positionsOf = (image: Image): Map<string, number | null> => new Map(image.layers.map((entry) => [entry.layerId, entry.idx]));

interface Depths {
  undoDepth: number;
  redoDepth: number;
}

export async function depths(client: Queryable | null, projectId: string, personId: string): Promise<Depths> {
  const sql = `SELECT count(*) FILTER (WHERE NOT undone)::int AS undo, count(*) FILTER (WHERE undone)::int AS redo
               FROM op_history WHERE project_id = $1 AND person_id = $2`;
  const row = client ? (await client.query<{ undo: number; redo: number }>(sql, [projectId, personId])).rows[0] : (await query<{ undo: number; redo: number }>(sql, [projectId, personId]))[0];
  return { undoDepth: row?.undo ?? 0, redoDepth: row?.redo ?? 0 };
}

/** Records a new step: clears the person's redo list and drops the oldest steps beyond UNDO_LIMIT. */
export async function recordStep(client: Queryable, input: { projectId: string; personId: string; opId: string; before: Image; after: Image; at: Date }): Promise<void> {
  await client.query('DELETE FROM op_history WHERE project_id = $1 AND person_id = $2 AND undone', [input.projectId, input.personId]);
  await client.query('INSERT INTO op_history (project_id, person_id, op_id, before, after, created_at) VALUES ($1, $2, $3, $4, $5, $6)', [
    input.projectId,
    input.personId,
    input.opId,
    JSON.stringify(input.before),
    JSON.stringify(input.after),
    input.at,
  ]);
  await client.query(
    `DELETE FROM op_history WHERE id IN (
       SELECT id FROM op_history WHERE project_id = $1 AND person_id = $2 ORDER BY id DESC OFFSET $3)`,
    [input.projectId, input.personId, config.undoLimit],
  );
}

interface Step {
  id: string;
  before: Image;
  after: Image;
}

/** The step undo would revert (the person's latest not undone), or the one redo would reapply (the oldest undone). */
export async function nextStep(client: Queryable, projectId: string, personId: string, direction: 'undo' | 'redo'): Promise<Step | null> {
  const sql =
    direction === 'undo'
      ? 'SELECT id, before, after FROM op_history WHERE project_id = $1 AND person_id = $2 AND NOT undone ORDER BY id DESC LIMIT 1 FOR UPDATE'
      : 'SELECT id, before, after FROM op_history WHERE project_id = $1 AND person_id = $2 AND undone ORDER BY id ASC LIMIT 1 FOR UPDATE';
  const result = await client.query<Step>(sql, [projectId, personId]);
  return result.rows[0] ?? null;
}

export async function markStep(client: Queryable, stepId: string, undone: boolean): Promise<void> {
  await client.query('UPDATE op_history SET undone = $2 WHERE id = $1', [stepId, undone]);
}
