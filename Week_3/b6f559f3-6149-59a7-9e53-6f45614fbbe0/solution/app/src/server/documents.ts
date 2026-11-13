/** Reading and writing a project's document as rows: scenes, layers (one row each), variables and presets. */
import type { Patch } from '../shared/document';
import { SCHEMA_VERSION, type AssetInfo, type Layer, type Preset, type Scene, type SceneDocument, type SceneFields, type Variable } from '../shared/types';
import type { Queryable } from './db';

interface LayerRow {
  id: string;
  scene_id: string;
  idx: string;
  parent_id: string | null;
  ord: number;
  name: string;
  kind: Layer['kind'];
  visible: boolean;
  locked: boolean;
  mask_above: boolean;
  blend_mode: Layer['blendMode'];
  props: Layer['props'];
  overrides: Layer['overrides'];
  keyframes: Layer['keyframes'];
  events: Layer['events'];
  bindings: Layer['bindings'];
}

const layerOf = (row: LayerRow): Layer => ({
  id: row.id,
  name: row.name,
  kind: row.kind,
  parentId: row.parent_id,
  order: row.ord,
  visible: row.visible,
  locked: row.locked,
  maskAbove: row.mask_above,
  blendMode: row.blend_mode,
  props: row.props,
  overrides: row.overrides,
  keyframes: row.keyframes,
  events: row.events,
  bindings: row.bindings,
});

interface LoadedDocument {
  document: SceneDocument;
  /** Position of each layer in its scene's array, for exact restores. */
  idx: Map<string, number>;
}

export async function loadDocument(client: Queryable, projectId: string): Promise<LoadedDocument> {
  const project = await client.query<{ name: string }>('SELECT name FROM projects WHERE id = $1', [projectId]);
  const scenes = await client.query<{ id: string; name: string; fields: Omit<SceneFields, 'id' | 'name'> }>('SELECT id, name, fields FROM scenes WHERE project_id = $1 ORDER BY position', [projectId]);
  const layers = await client.query<LayerRow>('SELECT * FROM layers WHERE project_id = $1 ORDER BY idx', [projectId]);
  const variables = await client.query<Variable>('SELECT name, type, value FROM variables WHERE project_id = $1 ORDER BY position', [projectId]);
  const presets = await client.query<Preset>('SELECT name, values FROM presets WHERE project_id = $1 ORDER BY position', [projectId]);
  const idx = new Map<string, number>();
  const byScene = new Map<string, Layer[]>();
  for (const row of layers.rows) {
    idx.set(row.id, Number(row.idx));
    byScene.set(row.scene_id, [...(byScene.get(row.scene_id) ?? []), layerOf(row)]);
  }
  const document: SceneDocument = {
    schemaVersion: SCHEMA_VERSION,
    name: project.rows[0]?.name ?? '',
    variables: variables.rows,
    presets: presets.rows,
    scenes: scenes.rows.map<Scene>((scene) => ({ id: scene.id, name: scene.name, ...scene.fields, layers: byScene.get(scene.id) ?? [] })),
  };
  return { document, idx };
}

/** The project's change counter: what a client compares patches against. */
export async function projectSeq(client: Queryable, projectId: string): Promise<number> {
  const row = (await client.query<{ seq: string }>('SELECT seq FROM projects WHERE id = $1', [projectId])).rows[0];
  return Number(row?.seq ?? 0);
}

const json = (value: unknown): string => JSON.stringify(value);

const sceneFieldsJson = (fields: SceneFields): string => {
  const { id: _id, name: _name, ...rest } = fields;
  void _id;
  void _name;
  return json(rest);
};

/** Upserts one layer row. `idx` keeps or restores its position in the scene's array; new rows draw the next one. */
export async function writeLayer(client: Queryable, projectId: string, sceneId: string, layer: Layer, idx?: number): Promise<number> {
  const values = [
    projectId,
    layer.id,
    sceneId,
    layer.parentId,
    layer.order,
    layer.name,
    layer.kind,
    layer.visible,
    layer.locked,
    layer.maskAbove,
    layer.blendMode,
    json(layer.props),
    json(layer.overrides),
    json(layer.keyframes),
    json(layer.events),
    json(layer.bindings),
  ];
  const columns = `project_id, id, scene_id, parent_id, ord, name, kind, visible, locked, mask_above, blend_mode, props, overrides, keyframes, events, bindings`;
  const update = `scene_id = $3, parent_id = $4, ord = $5, name = $6, kind = $7, visible = $8, locked = $9, mask_above = $10, blend_mode = $11, props = $12, overrides = $13, keyframes = $14, events = $15, bindings = $16`;
  const result =
    idx === undefined
      ? await client.query<{ idx: string }>(
          `INSERT INTO layers (${columns}) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
           ON CONFLICT (project_id, id) DO UPDATE SET ${update} RETURNING idx`,
          values,
        )
      : await client.query<{ idx: string }>(
          `INSERT INTO layers (${columns}, idx) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
           ON CONFLICT (project_id, id) DO UPDATE SET ${update} RETURNING idx`,
          [...values, idx],
        );
  return Number(result.rows[0]?.idx);
}

export async function deleteLayers(client: Queryable, projectId: string, layerIds: string[]): Promise<void> {
  if (layerIds.length > 0) await client.query('DELETE FROM layers WHERE project_id = $1 AND id = ANY($2::text[])', [projectId, layerIds]);
}

export async function writeSceneFields(client: Queryable, projectId: string, fields: SceneFields): Promise<void> {
  await client.query('UPDATE scenes SET fields = $3 WHERE project_id = $1 AND id = $2', [projectId, fields.id, sceneFieldsJson(fields)]);
}

export async function writeVariables(client: Queryable, projectId: string, variables: Variable[]): Promise<void> {
  const current = await client.query<{ name: string }>('SELECT name FROM variables WHERE project_id = $1', [projectId]);
  const keep = new Set(variables.map((v) => v.name));
  await deleteNames(client, 'variables', projectId, current.rows.map((r) => r.name).filter((n) => !keep.has(n)));
  for (const variable of variables) {
    await client.query(
      `INSERT INTO variables (project_id, name, type, value) VALUES ($1, $2, $3, $4)
       ON CONFLICT (project_id, name) DO UPDATE SET type = $3, value = $4`,
      [projectId, variable.name, variable.type, json(variable.value)],
    );
  }
}

export async function writePresets(client: Queryable, projectId: string, presets: Preset[]): Promise<void> {
  const current = await client.query<{ name: string }>('SELECT name FROM presets WHERE project_id = $1', [projectId]);
  const keep = new Set(presets.map((p) => p.name));
  await deleteNames(client, 'presets', projectId, current.rows.map((r) => r.name).filter((n) => !keep.has(n)));
  for (const preset of presets) {
    await client.query(
      `INSERT INTO presets (project_id, name, values) VALUES ($1, $2, $3)
       ON CONFLICT (project_id, name) DO UPDATE SET values = $3`,
      [projectId, preset.name, json(preset.values)],
    );
  }
}

async function deleteNames(client: Queryable, table: 'variables' | 'presets', projectId: string, names: string[]): Promise<void> {
  if (names.length > 0) await client.query(`DELETE FROM ${table} WHERE project_id = $1 AND name = ANY($2::text[])`, [projectId, names]);
}

/** Inserts a complete document's scenes, layers, variables and presets for a project row that already exists. */
export async function insertDocument(client: Queryable, projectId: string, document: SceneDocument): Promise<void> {
  for (const scene of document.scenes) {
    const { layers, ...fields } = scene;
    await client.query('INSERT INTO scenes (project_id, id, name, fields) VALUES ($1, $2, $3, $4)', [projectId, scene.id, scene.name, sceneFieldsJson(fields)]);
    for (const layer of layers) await writeLayer(client, projectId, scene.id, layer);
  }
  await writeVariables(client, projectId, document.variables);
  await writePresets(client, projectId, document.presets);
}

/** Applies a patch's end state to the rows (used by undo and redo, whose images are patches with positions). */
export async function writePatch(
  client: Queryable,
  projectId: string,
  patch: Patch,
  positions: ReadonlyMap<string, number | null>,
): Promise<void> {
  await deleteLayers(client, projectId, patch.removed.map((r) => r.layerId));
  for (const { sceneId, layer } of patch.layers) await writeLayer(client, projectId, sceneId, layer, positions.get(layer.id) ?? undefined);
  for (const fields of patch.scenes) await writeSceneFields(client, projectId, fields);
  if (patch.variables) await writeVariables(client, projectId, patch.variables);
  if (patch.presets) await writePresets(client, projectId, patch.presets);
}

interface AssetRow {
  id: string;
  kind: AssetInfo['kind'];
  file_name: string;
  bytes: number;
  sha256: string;
  status: AssetInfo['status'];
  width: number | null;
  height: number | null;
  vertices: number | null;
  clips: AssetInfo['clips'];
  model: AssetInfo['model'];
  outline: AssetInfo['outline'];
}

export const assetOf = (row: AssetRow): AssetInfo => ({
  id: row.id,
  kind: row.kind,
  fileName: row.file_name,
  bytes: row.bytes,
  sha256: row.sha256,
  status: row.status,
  width: row.width,
  height: row.height,
  vertices: row.vertices,
  clips: row.clips,
  model: row.model,
  outline: row.outline,
});

/** The project's confirmed assets, which are the only ones the API lists. */
export async function loadAssets(client: Queryable, projectId: string): Promise<AssetInfo[]> {
  const result = await client.query<AssetRow>(
    `SELECT id, kind, file_name, bytes, sha256, status, width, height, vertices, clips, model, outline
     FROM assets WHERE project_id = $1 AND status = 'confirmed' ORDER BY created_at, id`,
    [projectId],
  );
  return result.rows.map(assetOf);
}

/** Every asset's status, pending and failed ones included. */
export async function loadAssetStatuses(client: Queryable, projectId: string): Promise<Map<string, AssetInfo['status']>> {
  const result = await client.query<{ id: string; status: AssetInfo['status'] }>('SELECT id, status FROM assets WHERE project_id = $1', [projectId]);
  return new Map(result.rows.map((r) => [r.id, r.status]));
}
