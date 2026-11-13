import type { PoolClient } from 'pg';
import { query, queryOne } from './db';
import { serverNow } from './clock';
import type {
  JsonObject,
  JsonValue,
  Layer,
  LayerEvents,
  LayerKind,
  Preset,
  Scene,
  SceneDocument,
  Variable,
  VariableType,
} from '../shared/types';
import { SCHEMA_VERSION, defaultEvents } from '../shared/scene-doc';

export type Role = 'Owner' | 'Editor' | 'Viewer';

export interface ProjectRow {
  id: string;
  workspace_id: string;
  name: string;
  status: string;
  trashed_at: string | null;
  purge_at: string | null;
  imported: boolean;
}

export interface ProjectSummary {
  id: string;
  name: string;
  workspaceId: string;
  status: string;
  role: Role;
  layerCount: number;
  liveVersion: number | null;
  editorCount: number;
  viewerCount: number;
  trashedAt: string | null;
  purgeAt: string | null;
}

export async function purgeExpired(): Promise<void> {
  const now = await serverNow();
  await query(
    `DELETE FROM projects WHERE status = 'trashed' AND purge_at IS NOT NULL AND purge_at <= $1`,
    [now.toISOString()],
  );
}

export async function projectRow(projectId: string): Promise<ProjectRow | null> {
  return queryOne<ProjectRow>(
    `SELECT id, workspace_id, name, status, trashed_at, purge_at, imported FROM projects WHERE id = $1`,
    [projectId],
  );
}

export async function roleOf(projectId: string, personId: string): Promise<Role | null> {
  const row = await queryOne<{ role: string }>(
    `SELECT role FROM members WHERE project_id = $1 AND person_id = $2`,
    [projectId, personId],
  );
  return (row?.role as Role) ?? null;
}

export async function projectSummary(
  row: ProjectRow,
  role: Role,
): Promise<ProjectSummary> {
  const counts = await queryOne<{ layer_count: string }>(
    `SELECT COUNT(*)::text AS layer_count FROM layers
     WHERE project_id = $1 AND kind <> 'Group'`,
    [row.id],
  );
  const live = await queryOne<{ number: number }>(
    `SELECT number FROM versions WHERE project_id = $1 AND status = 'live' ORDER BY number DESC LIMIT 1`,
    [row.id],
  );
  const members = await query<{ role: string; count: string }>(
    `SELECT role, COUNT(*)::text AS count FROM members WHERE project_id = $1 GROUP BY role`,
    [row.id],
  );
  const countFor = (name: string): number =>
    Number(members.find((member) => member.role === name)?.count ?? '0');
  return {
    id: row.id,
    name: row.name,
    workspaceId: row.workspace_id,
    status: row.status,
    role,
    layerCount: Number(counts?.layer_count ?? '0'),
    liveVersion: live?.number ?? null,
    editorCount: countFor('Editor'),
    viewerCount: countFor('Viewer'),
    trashedAt: row.status === 'trashed' ? row.trashed_at : null,
    purgeAt: row.status === 'trashed' ? row.purge_at : null,
  };
}

interface SceneRow {
  id: string;
  name: string;
  order_index: number;
  settings: JsonObject;
}

interface LayerRow {
  id: string;
  scene_id: string;
  name: string;
  kind: string;
  parent_id: string | null;
  order_index: number;
  visible: boolean;
  locked: boolean;
  mask_above: boolean;
  blend_mode: string;
  props: JsonObject;
  overrides: JsonObject;
  keyframes: JsonValue;
  events: JsonObject;
  bindings: JsonObject;
}

function sceneFromRow(row: SceneRow, layers: Layer[]): Scene {
  const settings = row.settings as unknown as Omit<Scene, 'id' | 'name' | 'layers'>;
  return {
    id: row.id,
    name: row.name,
    background: settings.background,
    environment: settings.environment,
    durationMs: settings.durationMs,
    camera: settings.camera,
    orbit: settings.orbit,
    light: settings.light,
    layers,
  };
}

function layerFromRow(row: LayerRow): Layer {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind as LayerKind,
    parentId: row.parent_id,
    order: row.order_index,
    visible: row.visible,
    locked: row.locked,
    maskAbove: row.mask_above,
    blendMode: row.blend_mode,
    props: row.props,
    overrides: (row.overrides as unknown as Layer['overrides']) ?? { tablet: {}, mobile: {} },
    keyframes: (row.keyframes as unknown as Layer['keyframes']) ?? [],
    events: (row.events as unknown as LayerEvents) ?? defaultEvents(),
    bindings: (row.bindings as unknown as Record<string, string>) ?? {},
  };
}

export async function loadDocument(projectId: string): Promise<SceneDocument> {
  const project = await projectRow(projectId);
  const sceneRows = await query<SceneRow>(
    `SELECT id, name, order_index, settings FROM scenes WHERE project_id = $1 ORDER BY order_index`,
    [projectId],
  );
  const layerRows = await query<LayerRow>(
    `SELECT * FROM layers WHERE project_id = $1 ORDER BY order_index`,
    [projectId],
  );
  const variableRows = await query<{ name: string; type: string; value: JsonValue }>(
    `SELECT name, type, value FROM variables WHERE project_id = $1 ORDER BY order_index`,
    [projectId],
  );
  const presetRows = await query<{ name: string; values: JsonObject }>(
    `SELECT name, values FROM presets WHERE project_id = $1 ORDER BY order_index`,
    [projectId],
  );
  const scenes = sceneRows.map((scene) =>
    sceneFromRow(
      scene,
      layerRows.filter((layer) => layer.scene_id === scene.id).map(layerFromRow),
    ),
  );
  const variables: Variable[] = variableRows.map((row) => ({
    name: row.name,
    type: row.type as VariableType,
    value: row.value,
  }));
  const presets: Preset[] = presetRows.map((row) => ({
    name: row.name,
    values: row.values as Record<string, JsonValue>,
  }));
  return {
    schemaVersion: SCHEMA_VERSION,
    name: project?.name ?? '',
    variables,
    presets,
    scenes,
  };
}

export async function persistDocument(
  client: PoolClient,
  projectId: string,
  document: SceneDocument,
): Promise<void> {
  const sceneIds = document.scenes.map((scene) => scene.id);
  if (sceneIds.length === 0) {
    await client.query(`DELETE FROM scenes WHERE project_id = $1`, [projectId]);
  } else {
    await client.query(
      `DELETE FROM scenes WHERE project_id = $1 AND id <> ALL($2::text[])`,
      [projectId, sceneIds],
    );
  }
  for (let index = 0; index < document.scenes.length; index += 1) {
    const scene = document.scenes[index];
    const settings = {
      background: scene.background,
      environment: scene.environment,
      durationMs: scene.durationMs,
      camera: scene.camera,
      orbit: scene.orbit,
      light: scene.light,
    };
    await client.query(
      `INSERT INTO scenes (id, project_id, name, order_index, settings)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (project_id, id) DO UPDATE SET name = EXCLUDED.name, order_index = EXCLUDED.order_index,
         settings = EXCLUDED.settings`,
      [scene.id, projectId, scene.name, index, JSON.stringify(settings)],
    );
    const layerIds = scene.layers.map((layer) => layer.id);
    if (layerIds.length === 0) {
      await client.query(`DELETE FROM layers WHERE project_id = $1 AND scene_id = $2`, [
        projectId,
        scene.id,
      ]);
    } else {
      await client.query(
        `DELETE FROM layers WHERE project_id = $1 AND scene_id = $2 AND id <> ALL($3::text[])`,
        [projectId, scene.id, layerIds],
      );
    }
    for (const layer of scene.layers) {
      await client.query(
        `INSERT INTO layers (id, project_id, scene_id, name, kind, parent_id, order_index, visible, locked,
           mask_above, blend_mode, props, overrides, keyframes, events, bindings)
         VALUES ($1,$16,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
         ON CONFLICT (project_id, id) DO UPDATE SET scene_id = EXCLUDED.scene_id, name = EXCLUDED.name,
           kind = EXCLUDED.kind, parent_id = EXCLUDED.parent_id, order_index = EXCLUDED.order_index,
           visible = EXCLUDED.visible, locked = EXCLUDED.locked, mask_above = EXCLUDED.mask_above,
           blend_mode = EXCLUDED.blend_mode, props = EXCLUDED.props, overrides = EXCLUDED.overrides,
           keyframes = EXCLUDED.keyframes, events = EXCLUDED.events, bindings = EXCLUDED.bindings`,
        [
          layer.id,
          scene.id,
          layer.name,
          layer.kind,
          layer.parentId,
          layer.order,
          layer.visible,
          layer.locked,
          layer.maskAbove,
          layer.blendMode,
          JSON.stringify(layer.props),
          JSON.stringify(layer.overrides),
          JSON.stringify(layer.keyframes),
          JSON.stringify(layer.events),
          JSON.stringify(layer.bindings),
          projectId,
        ],
      );
    }
  }
  const variableNames = document.variables.map((variable) => variable.name);
  if (variableNames.length === 0) {
    await client.query(`DELETE FROM variables WHERE project_id = $1`, [projectId]);
  } else {
    await client.query(`DELETE FROM variables WHERE project_id = $1 AND name <> ALL($2::text[])`, [
      projectId,
      variableNames,
    ]);
  }
  for (let index = 0; index < document.variables.length; index += 1) {
    const variable = document.variables[index];
    await client.query(
      `INSERT INTO variables (project_id, name, type, value, order_index)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (project_id, name) DO UPDATE SET type = EXCLUDED.type, value = EXCLUDED.value,
         order_index = EXCLUDED.order_index`,
      [projectId, variable.name, variable.type, JSON.stringify(variable.value), index],
    );
  }
  const presetNames = document.presets.map((preset) => preset.name);
  if (presetNames.length === 0) {
    await client.query(`DELETE FROM presets WHERE project_id = $1`, [projectId]);
  } else {
    await client.query(`DELETE FROM presets WHERE project_id = $1 AND name <> ALL($2::text[])`, [
      projectId,
      presetNames,
    ]);
  }
  for (let index = 0; index < document.presets.length; index += 1) {
    const preset = document.presets[index];
    await client.query(
      `INSERT INTO presets (project_id, name, values, order_index)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (project_id, name) DO UPDATE SET values = EXCLUDED.values,
         order_index = EXCLUDED.order_index`,
      [projectId, preset.name, JSON.stringify(preset.values), index],
    );
  }
}

export interface AssetRow {
  id: string;
  project_id: string;
  kind: string;
  file_name: string;
  content_type: string;
  bytes: number;
  sha256: string;
  status: string;
  width: number | null;
  height: number | null;
  vertices: number | null;
  clips: JsonValue;
  parsed: JsonValue;
}

export async function loadAssets(projectId: string): Promise<AssetRow[]> {
  return query<AssetRow>(
    `SELECT * FROM assets WHERE project_id = $1 ORDER BY created_at`,
    [projectId],
  );
}
