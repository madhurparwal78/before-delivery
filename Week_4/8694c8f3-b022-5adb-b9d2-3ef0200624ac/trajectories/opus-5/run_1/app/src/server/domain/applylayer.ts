import type pg from 'pg';
import { ApiError, Err, fieldError } from '../errors.js';
import { asBoolean, asInteger, asString, asStringArray } from '../input.js';
import { sha256Hex } from '../storage.js';
import { isUuid } from '../access.js';
import {
  BUS_KINDS,
  LAYER_KINDS,
  MAX_TICK,
  OUTPUT_BUSES,
  rangeForPath,
  RANGES,
  STARTER_SHADER_SOURCE,
  COPY,
  isKeyableProperty,
  type LayerKind,
  type OutputBus,
} from '../../shared/domain.js';
import { numberInRange, textInLength, vec3InRange, sourceText } from './validate.js';
import { readLayer } from './document.js';
import { closeGap, descendantIds, insertLayer, openGap, siblingCount } from './layers.js';
import { bumpLayer, checkBaseVersion, type Applied, type ApplyContext } from './version.js';
import { describeValue, propertyLabel, keySummary } from './optypes.js';
import type { LayerDoc } from '../../shared/types.js';

async function layerOrNotFound(ctx: ApplyContext, layerId: string): Promise<LayerDoc> {
  const layer = await readLayer(ctx.client, ctx.setId, layerId);
  if (layer === null) throw Err.notFound();
  return layer;
}

async function readyAsset(
  client: pg.PoolClient,
  setId: string,
  assetId: string,
  kind: 'model' | 'texture',
): Promise<boolean> {
  if (!isUuid(assetId)) return false;
  const result = await client.query(
    `select 1 from assets where id = $1 and set_id = $2 and kind = $3 and status = 'ready'`,
    [assetId, setId, kind],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function applyLayerAdd(ctx: ApplyContext): Promise<Applied> {
  if (!isUuid(ctx.target)) throw fieldError('target', 'Target must be a new layer id');
  const existing = await ctx.client.query(`select 1 from layers where id = $1`, [ctx.target]);
  if ((existing.rowCount ?? 0) > 0) throw new ApiError(409, 'id_taken', 'That layer id is already in use');

  const kindText = asString(ctx.payload['kind']) ?? '';
  if (!(LAYER_KINDS as readonly string[]).includes(kindText)) {
    throw fieldError('kind', 'Choose one of the layer kinds');
  }
  const kind = kindText as LayerKind;
  const name = textInLength('name', ctx.payload['name'], 1, 60, 'Layer name');
  const parentValue = ctx.payload['parent_id'];
  const parentId = parentValue === null || parentValue === undefined ? null : asString(parentValue);
  if (parentValue !== null && parentValue !== undefined && parentId === null) {
    throw fieldError('parent_id', 'Choose a layer in this set');
  }
  if (parentId !== null) {
    const parent = await readLayer(ctx.client, ctx.setId, parentId);
    if (parent === null) throw fieldError('parent_id', 'Choose a layer in this set');
  }
  const count = await siblingCount(ctx.client, ctx.setId, parentId, null);
  const index = asInteger(ctx.payload['index']);
  if (index === null || index < 0 || index > count) {
    throw fieldError('index', `Index must be an integer from 0 to ${count}`);
  }

  await openGap(ctx.client, ctx.setId, parentId, index);
  const shaderVersion = kind === 'shader' ? 1 : null;
  await insertLayer(ctx.client, {
    id: ctx.target,
    setId: ctx.setId,
    parentId,
    index,
    name,
    kind,
    shaderVersion,
  });
  if (kind === 'shader') {
    await ctx.client.query(
      `insert into shader_versions (set_id, layer_id, number, source, sha256, size, author_id)
       values ($1, $2, 1, $3, $4, $5, $6)`,
      [
        ctx.setId,
        ctx.target,
        STARTER_SHADER_SOURCE,
        sha256Hex(STARTER_SHADER_SOURCE),
        Buffer.byteLength(STARTER_SHADER_SOURCE, 'utf8'),
        ctx.user.id,
      ],
    );
  }
  if (kind === 'camera' && ctx.setRow.active_camera_id === null) {
    await ctx.client.query(`update sets set active_camera_id = $2 where id = $1`, [ctx.setId, ctx.target]);
  }
  return { version: 1, summary: `Added ${kind} ${name}` };
}

const LAYER_SET_PATHS = new Set([
  'name',
  'visible',
  'position',
  'rotation',
  'scale',
  'position.x',
  'position.y',
  'position.z',
  'rotation.x',
  'rotation.y',
  'rotation.z',
  'scale.x',
  'scale.y',
  'scale.z',
  'material.tint',
  'material.tint_alpha',
  'material.albedo_texture_id',
  'material.emissive_texture_id',
  'model_asset_id',
  'output_buses',
]);

const AXIS_INDEX: Record<string, number> = { x: 1, y: 2, z: 3 };

export async function applyLayerSet(ctx: ApplyContext): Promise<Applied> {
  const layer = await layerOrNotFound(ctx, ctx.target);
  await checkBaseVersion(ctx, layer.version, layer);
  const path = asString(ctx.payload['path']) ?? '';
  const raw = ctx.payload['value'];
  const isProp = path.startsWith('props.');
  if (!LAYER_SET_PATHS.has(path) && !isProp) throw fieldError('path', 'That property cannot be set');

  const client = ctx.client;
  let stored: unknown = raw;

  if (path === 'name') {
    stored = textInLength('value', raw, 1, 60, 'Layer name');
    await client.query(`update layers set name = $2 where id = $1`, [layer.id, stored]);
  } else if (path === 'visible') {
    const visible = asBoolean(raw);
    if (visible === null) throw fieldError('value', 'Visible is on or off');
    stored = visible;
    await client.query(`update layers set visible = $2 where id = $1`, [layer.id, visible]);
  } else if (path === 'position' || path === 'rotation' || path === 'scale') {
    const range = rangeForPath(path);
    if (range === null) throw fieldError('path', 'That property cannot be set');
    const triple = vec3InRange('value', raw, range);
    stored = triple;
    await client.query(`update layers set ${path} = $2 where id = $1`, [layer.id, triple]);
  } else if (/^(position|rotation|scale)\.[xyz]$/.test(path)) {
    const [column, axis] = path.split('.') as [string, string];
    const range = rangeForPath(path);
    if (range === null) throw fieldError('path', 'That property cannot be set');
    const value = numberInRange('value', raw, range);
    stored = value;
    await client.query(`update layers set ${column}[${AXIS_INDEX[axis] ?? 1}] = $2 where id = $1`, [
      layer.id,
      value,
    ]);
  } else if (isProp) {
    const prop = path.slice('props.'.length);
    if (!(prop in layer.props)) throw fieldError('path', 'This layer has no such property');
    const range = rangeForPath(path);
    if (range === null) throw fieldError('path', 'That property cannot be set');
    const value = numberInRange('value', raw, range);
    if (prop === 'far' && value <= (layer.props['near'] ?? 0)) {
      throw fieldError('value', 'Far plane must be greater than the near plane');
    }
    if (prop === 'near' && value >= (layer.props['far'] ?? Number.POSITIVE_INFINITY)) {
      throw fieldError('value', 'Near plane must be less than the far plane');
    }
    stored = value;
    await client.query(`update layers set props = jsonb_set(props, $2::text[], $3::jsonb) where id = $1`, [
      layer.id,
      [prop],
      JSON.stringify(value),
    ]);
  } else if (path.startsWith('material.')) {
    if (layer.material === null) throw fieldError('path', 'This layer has no material');
    const slot = path.slice('material.'.length);
    if (slot === 'tint') {
      const triple = vec3InRange('value', raw, RANGES.tint);
      stored = triple;
      await client.query(
        `update layers set material = jsonb_set(material, '{tint}', $2::jsonb) where id = $1`,
        [layer.id, JSON.stringify(triple)],
      );
    } else if (slot === 'tint_alpha') {
      const value = numberInRange('value', raw, RANGES.tint_alpha);
      stored = value;
      await client.query(
        `update layers set material = jsonb_set(material, '{tint_alpha}', $2::jsonb) where id = $1`,
        [layer.id, JSON.stringify(value)],
      );
    } else {
      const assetId = raw === null ? null : asString(raw);
      if (raw !== null && assetId === null) throw fieldError('value', 'Choose a ready texture asset');
      if (assetId !== null && !(await readyAsset(client, ctx.setId, assetId, 'texture'))) {
        throw fieldError('value', 'Choose a ready texture asset');
      }
      stored = assetId;
      await client.query(`update layers set material = jsonb_set(material, $2::text[], $3::jsonb) where id = $1`, [
        layer.id,
        [slot],
        JSON.stringify(assetId),
      ]);
    }
  } else if (path === 'model_asset_id') {
    if (layer.kind !== 'model') throw fieldError('path', 'Only model layers bind a model asset');
    const assetId = raw === null ? null : asString(raw);
    if (raw !== null && assetId === null) throw fieldError('value', 'Choose a ready model asset');
    if (assetId !== null && !(await readyAsset(client, ctx.setId, assetId, 'model'))) {
      throw fieldError('value', 'Choose a ready model asset');
    }
    stored = assetId;
    await client.query(`update layers set model_asset_id = $2 where id = $1`, [layer.id, assetId]);
  } else {
    if (!BUS_KINDS.includes(layer.kind)) throw fieldError('path', 'This layer kind has no output buses');
    const buses = asStringArray(raw);
    if (buses === null || buses.length === 0 || !buses.every((bus) => (OUTPUT_BUSES as readonly string[]).includes(bus))) {
      throw fieldError('value', 'Choose at least one output bus');
    }
    const unique = [...new Set(buses)] as OutputBus[];
    stored = unique;
    await client.query(`update layers set output_buses = $2 where id = $1`, [layer.id, unique]);
  }

  const version = await bumpLayer(ctx, layer.id);
  return {
    version,
    summary: `Set ${propertyLabel(path)} on ${layer.name} to ${describeValue(stored)}`,
  };
}

export async function applyLayerReparent(ctx: ApplyContext): Promise<Applied> {
  const layer = await layerOrNotFound(ctx, ctx.target);
  await checkBaseVersion(ctx, layer.version, layer);
  const parentValue = ctx.payload['parent_id'];
  const parentId = parentValue === null || parentValue === undefined ? null : asString(parentValue);
  if (parentValue !== null && parentValue !== undefined && parentId === null) {
    throw fieldError('parent_id', 'Choose a layer in this set');
  }
  if (parentId !== null) {
    if (parentId === layer.id) throw fieldError('parent_id', COPY.ownAncestor);
    const parent = await readLayer(ctx.client, ctx.setId, parentId);
    if (parent === null) throw fieldError('parent_id', 'Choose a layer in this set');
    const descendants = await descendantIds(ctx.client, ctx.setId, layer.id);
    if (descendants.includes(parentId)) throw fieldError('parent_id', COPY.ownAncestor);
  }
  const count = await siblingCount(ctx.client, ctx.setId, parentId, layer.id);
  const index = asInteger(ctx.payload['index']);
  if (index === null || index < 0 || index > count) {
    throw fieldError('index', `Index must be an integer from 0 to ${count}`);
  }

  await ctx.client.query(`update layers set parent_id = null, idx = -1 where id = $1`, [layer.id]);
  await closeGap(ctx.client, ctx.setId, layer.parent_id, layer.index);
  await openGap(ctx.client, ctx.setId, parentId, index);
  await ctx.client.query(`update layers set parent_id = $2, idx = $3 where id = $1`, [
    layer.id,
    parentId,
    index,
  ]);
  const version = await bumpLayer(ctx, layer.id);
  return { version, summary: `Moved ${layer.name} in the layer tree` };
}

export async function applyLayerRemove(ctx: ApplyContext): Promise<Applied> {
  const layer = await layerOrNotFound(ctx, ctx.target);
  await checkBaseVersion(ctx, layer.version, layer);
  const removed = [layer.id, ...(await descendantIds(ctx.client, ctx.setId, layer.id))];
  await ctx.client.query(
    `delete from graph_wires
      where set_id = $1 and (from_node in (
              select node_id from graph_nodes
               where set_id = $1 and type = 'Layer property' and params->>'layer_id' = any($2::text[]))
            or to_node in (
              select node_id from graph_nodes
               where set_id = $1 and type = 'Layer property' and params->>'layer_id' = any($2::text[])))`,
    [ctx.setId, removed],
  );
  await ctx.client.query(
    `delete from graph_nodes
      where set_id = $1 and type = 'Layer property' and params->>'layer_id' = any($2::text[])`,
    [ctx.setId, removed],
  );
  await ctx.client.query(`delete from layers where id = $1`, [layer.id]);
  await closeGap(ctx.client, ctx.setId, layer.parent_id, layer.index);

  if (ctx.setRow.active_camera_id !== null && removed.includes(ctx.setRow.active_camera_id)) {
    const remaining = await readLayer(ctx.client, ctx.setId, ctx.setRow.active_camera_id);
    if (remaining === null) {
      const cameras = await ctx.client.query<{ id: string }>(
        `select id from layers where set_id = $1 and kind = 'camera'`,
        [ctx.setId],
      );
      const first = cameras.rows[0]?.id ?? null;
      await ctx.client.query(`update sets set active_camera_id = $2 where id = $1`, [ctx.setId, first]);
    }
  }
  return { version: layer.version + 1, summary: `Removed ${layer.name}`, freedLayers: removed };
}

export async function applyShaderSave(ctx: ApplyContext): Promise<Applied> {
  const layer = await layerOrNotFound(ctx, ctx.target);
  await checkBaseVersion(ctx, layer.version, layer);
  if (layer.kind !== 'shader') throw fieldError('target', 'Shader saves need a shader layer');
  const source = sourceText('source', ctx.payload['source']);
  const number = await nextShaderNumber(ctx.client, layer.id);
  await insertShaderVersion(ctx, layer.id, number, source, null);
  const version = await bumpLayer(ctx, layer.id);
  return { version, summary: `Saved shader version ${number} on ${layer.name}` };
}

export async function applyShaderRestore(ctx: ApplyContext): Promise<Applied> {
  const layer = await layerOrNotFound(ctx, ctx.target);
  await checkBaseVersion(ctx, layer.version, layer);
  if (layer.kind !== 'shader') throw fieldError('target', 'Shader restores need a shader layer');
  const from = asInteger(ctx.payload['from_version']);
  if (from === null || from < 1) throw fieldError('from_version', 'Choose a saved shader version');
  const found = await ctx.client.query<{ source: string }>(
    `select source from shader_versions where layer_id = $1 and number = $2`,
    [layer.id, from],
  );
  const source = found.rows[0]?.source;
  if (source === undefined) throw fieldError('from_version', 'Choose a saved shader version');
  const number = await nextShaderNumber(ctx.client, layer.id);
  await insertShaderVersion(ctx, layer.id, number, source, from);
  const version = await bumpLayer(ctx, layer.id);
  return {
    version,
    summary: `Restored shader version ${from} on ${layer.name} as version ${number}`,
  };
}

async function nextShaderNumber(client: pg.PoolClient, layerId: string): Promise<number> {
  const result = await client.query<{ next: number }>(
    `select coalesce(max(number), 0) + 1 as next from shader_versions where layer_id = $1`,
    [layerId],
  );
  return result.rows[0]?.next ?? 1;
}

async function insertShaderVersion(
  ctx: ApplyContext,
  layerId: string,
  number: number,
  source: string,
  restoredFrom: number | null,
): Promise<void> {
  await ctx.client.query(
    `insert into shader_versions (set_id, layer_id, number, source, sha256, size, author_id, restored_from)
     values ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      ctx.setId,
      layerId,
      number,
      source,
      sha256Hex(source),
      Buffer.byteLength(source, 'utf8'),
      ctx.user.id,
      restoredFrom,
    ],
  );
  await ctx.client.query(`update layers set shader_version = $2 where id = $1`, [layerId, number]);
}

function keyableOnLayer(layer: LayerDoc, property: string): boolean {
  if (!isKeyableProperty(property)) return false;
  if (property.startsWith('props.')) return property.slice('props.'.length) in layer.props;
  if (property === 'material.tint_alpha') return layer.material !== null;
  return true;
}

export async function applyKeySet(ctx: ApplyContext): Promise<Applied> {
  const layer = await layerOrNotFound(ctx, ctx.target);
  await checkBaseVersion(ctx, layer.version, layer);
  const property = asString(ctx.payload['property']) ?? '';
  if (!keyableOnLayer(layer, property)) throw fieldError('property', 'That property cannot be keyed');
  const tick = asInteger(ctx.payload['tick']);
  if (tick === null || tick < 0 || tick >= MAX_TICK) {
    throw fieldError('tick', `Tick must be an integer from 0 to ${MAX_TICK - 1}`);
  }
  const range = rangeForPath(property);
  if (range === null) throw fieldError('property', 'That property cannot be keyed');
  const value = numberInRange('value', ctx.payload['value'], range);
  await ctx.client.query(
    `insert into keys (set_id, layer_id, property, tick, value) values ($1, $2, $3, $4, $5)
     on conflict (layer_id, property, tick) do update set value = excluded.value`,
    [ctx.setId, layer.id, property, tick, value],
  );
  const version = await bumpLayer(ctx, layer.id);
  return { version, summary: keySummary('Keyed', propertyLabel(property), layer.name, tick) };
}

export async function applyKeyRemove(ctx: ApplyContext): Promise<Applied> {
  const layer = await layerOrNotFound(ctx, ctx.target);
  await checkBaseVersion(ctx, layer.version, layer);
  const property = asString(ctx.payload['property']) ?? '';
  if (!isKeyableProperty(property)) throw fieldError('property', 'That property cannot be keyed');
  const tick = asInteger(ctx.payload['tick']);
  if (tick === null || tick < 0 || tick >= MAX_TICK) {
    throw fieldError('tick', `Tick must be an integer from 0 to ${MAX_TICK - 1}`);
  }
  await ctx.client.query(`delete from keys where layer_id = $1 and property = $2 and tick = $3`, [
    layer.id,
    property,
    tick,
  ]);
  const version = await bumpLayer(ctx, layer.id);
  return {
    version,
    summary: keySummary('Removed the key for', propertyLabel(property), layer.name, tick),
  };
}

