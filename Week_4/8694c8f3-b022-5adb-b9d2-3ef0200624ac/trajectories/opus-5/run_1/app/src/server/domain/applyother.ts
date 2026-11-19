import type pg from 'pg';
import { ApiError, Err, fieldError } from '../errors.js';
import { asNumber, asRecord, asString, asStringArray } from '../input.js';
import { isUuid } from '../access.js';
import { COPY, isKeyableProperty, LFO_SHAPES } from '../../shared/domain.js';
import { bumpGraph, bumpScript, bumpSettings, checkBaseVersion, type Applied, type ApplyContext } from './version.js';
import { BUILTIN_PORTS } from './optypes.js';
import { bpmValue, sourceText, textInLength } from './validate.js';
import { readGraph, readLayer, setHeader } from './document.js';
import type { GraphNodeDoc, ScriptDoc } from '../../shared/types.js';

export async function applySetUpdate(ctx: ApplyContext): Promise<Applied> {
  const current = setHeader(ctx.setRow, 'owner');
  await checkBaseVersion(ctx, ctx.setRow.settings_version, current);
  const parts: string[] = [];

  if ('name' in ctx.payload) {
    const name = textInLength('name', ctx.payload['name'], 1, 80, 'Set name');
    await ctx.client.query(`update sets set name = $2 where id = $1`, [ctx.setId, name]);
    parts.push(`Renamed the set to ${name}`);
  }
  if ('bpm' in ctx.payload) {
    const bpm = bpmValue('bpm', ctx.payload['bpm']);
    await ctx.client.query(`update sets set bpm = $2 where id = $1`, [ctx.setId, bpm]);
    parts.push(`Set BPM to ${bpm}`);
  }
  if ('active_camera_id' in ctx.payload) {
    const raw = ctx.payload['active_camera_id'];
    const cameraId = raw === null ? null : asString(raw);
    if (raw !== null && cameraId === null) throw fieldError('active_camera_id', 'Choose a camera layer in this set');
    if (cameraId !== null) {
      const layer = await readLayer(ctx.client, ctx.setId, cameraId);
      if (layer === null || layer.kind !== 'camera') {
        throw fieldError('active_camera_id', 'Choose a camera layer in this set');
      }
      await ctx.client.query(`update sets set active_camera_id = $2 where id = $1`, [ctx.setId, cameraId]);
      parts.push(`Set the active camera to ${layer.name}`);
    }
  }
  if (parts.length === 0) throw fieldError('payload', 'Nothing to update');
  const version = await bumpSettings(ctx);
  return { version, summary: parts.join(', ') };
}

async function graphState(ctx: ApplyContext) {
  return readGraph(ctx.client, ctx.setId, ctx.setRow.graph_version);
}

async function readNode(client: pg.PoolClient, setId: string, nodeId: string): Promise<GraphNodeDoc | null> {
  const result = await client.query<GraphNodeDoc>(
    `select node_id, type, params, x, y from graph_nodes where set_id = $1 and node_id = $2`,
    [setId, nodeId],
  );
  return result.rows[0] ?? null;
}

async function validatedParams(
  ctx: ApplyContext,
  type: string,
  params: Record<string, unknown>,
): Promise<Record<string, string | number>> {
  const out: Record<string, string | number> = {};
  const numberParam = (name: string, min: number, max: number): void => {
    const value = asNumber(params[name]);
    if (value === null || value < min || value > max) {
      throw fieldError('params', `${name} must be a number from ${min} to ${max}`);
    }
    out[name] = value;
  };
  if (type === 'LFO') {
    const shape = asString(params['shape']) ?? 'sine';
    if (!(LFO_SHAPES as readonly string[]).includes(shape)) {
      throw fieldError('params', 'shape must be sine, triangle, square or saw');
    }
    out['shape'] = shape;
    numberParam('rate_beats', 0.25, 16);
  } else if (type === 'Remap') {
    for (const name of ['in_min', 'in_max', 'out_min', 'out_max']) {
      numberParam(name, -1_000_000, 1_000_000);
    }
  } else if (type === 'Layer property') {
    const layerId = asString(params['layer_id']) ?? '';
    const layer = await readLayer(ctx.client, ctx.setId, layerId);
    if (layer === null) throw fieldError('params', 'layer_id must name a layer in this set');
    const property = asString(params['property']) ?? '';
    if (!isKeyableProperty(property)) throw fieldError('params', 'property must be a keyable property');
    out['layer_id'] = layerId;
    out['property'] = property;
  } else {
    for (const [name, value] of Object.entries(params)) {
      const asText = asString(value);
      const asNum = asNumber(value);
      if (asText !== null) out[name] = asText;
      else if (asNum !== null) out[name] = asNum;
      else throw fieldError('params', 'Node parameters are text or numbers');
    }
  }
  return out;
}

export async function applyGraphNodeAdd(ctx: ApplyContext): Promise<Applied> {
  if (ctx.target !== 'graph') throw fieldError('target', 'Graph ops target the graph');
  const nodeId = textInLength('node_id', ctx.payload['node_id'], 1, 64, 'Node id');
  if ((await readNode(ctx.client, ctx.setId, nodeId)) !== null) {
    throw new ApiError(409, 'id_taken', 'That node id is already in use');
  }
  const type = textInLength('type', ctx.payload['type'], 1, 40, 'Node type');
  const params = await validatedParams(ctx, type, asRecord(ctx.payload['params']) ?? {});
  const x = asNumber(ctx.payload['x']);
  const y = asNumber(ctx.payload['y']);
  if (x === null) throw fieldError('x', 'x must be a number');
  if (y === null) throw fieldError('y', 'y must be a number');
  await ctx.client.query(
    `insert into graph_nodes (set_id, node_id, type, params, x, y) values ($1, $2, $3, $4, $5, $6)`,
    [ctx.setId, nodeId, type, JSON.stringify(params), x, y],
  );
  const version = await bumpGraph(ctx);
  return { version, summary: `Added ${type} node` };
}

export async function applyGraphNodeUpdate(ctx: ApplyContext): Promise<Applied> {
  if (ctx.target !== 'graph') throw fieldError('target', 'Graph ops target the graph');
  await checkBaseVersion(ctx, ctx.setRow.graph_version, await graphState(ctx));
  const nodeId = asString(ctx.payload['node_id']) ?? '';
  const node = await readNode(ctx.client, ctx.setId, nodeId);
  if (node === null) throw fieldError('node_id', 'Choose a node in this graph');
  if ('params' in ctx.payload) {
    const params = await validatedParams(ctx, node.type, asRecord(ctx.payload['params']) ?? {});
    await ctx.client.query(`update graph_nodes set params = $3 where set_id = $1 and node_id = $2`, [
      ctx.setId,
      nodeId,
      JSON.stringify(params),
    ]);
  }
  for (const axis of ['x', 'y'] as const) {
    if (!(axis in ctx.payload)) continue;
    const value = asNumber(ctx.payload[axis]);
    if (value === null) throw fieldError(axis, `${axis} must be a number`);
    await ctx.client.query(`update graph_nodes set ${axis} = $3 where set_id = $1 and node_id = $2`, [
      ctx.setId,
      nodeId,
      value,
    ]);
  }
  const version = await bumpGraph(ctx);
  return { version, summary: `Updated ${node.type} node` };
}

export async function applyGraphNodeRemove(ctx: ApplyContext): Promise<Applied> {
  if (ctx.target !== 'graph') throw fieldError('target', 'Graph ops target the graph');
  await checkBaseVersion(ctx, ctx.setRow.graph_version, await graphState(ctx));
  const nodeId = asString(ctx.payload['node_id']) ?? '';
  const node = await readNode(ctx.client, ctx.setId, nodeId);
  if (node === null) throw fieldError('node_id', 'Choose a node in this graph');
  await ctx.client.query(
    `delete from graph_wires where set_id = $1 and (from_node = $2 or to_node = $2)`,
    [ctx.setId, nodeId],
  );
  await ctx.client.query(`delete from graph_nodes where set_id = $1 and node_id = $2`, [ctx.setId, nodeId]);
  const version = await bumpGraph(ctx);
  return { version, summary: `Removed ${node.type} node` };
}

interface PortRef {
  node_id: string;
  port: string;
}

function portRef(value: unknown): PortRef | null {
  const record = asRecord(value);
  if (record === null) return null;
  const nodeId = asString(record['node_id']);
  const port = asString(record['port']);
  if (nodeId === null || port === null) return null;
  return { node_id: nodeId, port };
}

export async function applyGraphWireAdd(ctx: ApplyContext): Promise<Applied> {
  if (ctx.target !== 'graph') throw fieldError('target', 'Graph ops target the graph');
  const wireId = textInLength('wire_id', ctx.payload['wire_id'], 1, 64, 'Wire id');
  const existing = await ctx.client.query(`select 1 from graph_wires where set_id = $1 and wire_id = $2`, [
    ctx.setId,
    wireId,
  ]);
  if ((existing.rowCount ?? 0) > 0) throw new ApiError(409, 'id_taken', 'That wire id is already in use');
  const from = portRef(ctx.payload['from']);
  const to = portRef(ctx.payload['to']);
  if (from === null) throw fieldError('from', 'A wire needs a from port');
  if (to === null) throw fieldError('to', 'A wire needs a to port');
  const fromNode = await readNode(ctx.client, ctx.setId, from.node_id);
  const toNode = await readNode(ctx.client, ctx.setId, to.node_id);
  if (fromNode === null) throw fieldError('from', 'Choose a node in this graph');
  if (toNode === null) throw fieldError('to', 'Choose a node in this graph');
  if (from.node_id === to.node_id) throw fieldError('to', COPY.wireDirection);

  const fromPorts = BUILTIN_PORTS[fromNode.type];
  const toPorts = BUILTIN_PORTS[toNode.type];
  if (fromPorts !== undefined && !fromPorts.outputs.includes(from.port)) {
    throw fieldError('to', COPY.wireDirection);
  }
  if (toPorts !== undefined && !toPorts.inputs.includes(to.port)) {
    throw fieldError('to', COPY.wireDirection);
  }

  const occupied = await ctx.client.query(
    `select 1 from graph_wires where set_id = $1 and to_node = $2 and to_port = $3`,
    [ctx.setId, to.node_id, to.port],
  );
  if ((occupied.rowCount ?? 0) > 0) throw fieldError('to', COPY.wireOccupied);

  const graph = await graphState(ctx);
  const edges = new Map<string, string[]>();
  for (const wire of graph.wires) {
    const list = edges.get(wire.from.node_id) ?? [];
    list.push(wire.to.node_id);
    edges.set(wire.from.node_id, list);
  }
  const seen = new Set<string>();
  const stack = [to.node_id];
  while (stack.length > 0) {
    const current = stack.pop() as string;
    if (current === from.node_id) throw fieldError('to', COPY.wireLoop);
    if (seen.has(current)) continue;
    seen.add(current);
    stack.push(...(edges.get(current) ?? []));
  }

  await ctx.client.query(
    `insert into graph_wires (set_id, wire_id, from_node, from_port, to_node, to_port)
     values ($1, $2, $3, $4, $5, $6)`,
    [ctx.setId, wireId, from.node_id, from.port, to.node_id, to.port],
  );
  const version = await bumpGraph(ctx);
  return { version, summary: `Wired ${fromNode.type} to ${toNode.type}` };
}

export async function applyGraphWireRemove(ctx: ApplyContext): Promise<Applied> {
  if (ctx.target !== 'graph') throw fieldError('target', 'Graph ops target the graph');
  await checkBaseVersion(ctx, ctx.setRow.graph_version, await graphState(ctx));
  const wireId = asString(ctx.payload['wire_id']) ?? '';
  const removed = await ctx.client.query(`delete from graph_wires where set_id = $1 and wire_id = $2`, [
    ctx.setId,
    wireId,
  ]);
  if ((removed.rowCount ?? 0) === 0) throw fieldError('wire_id', 'Choose a wire in this graph');
  const version = await bumpGraph(ctx);
  return { version, summary: 'Removed a wire' };
}

async function readScript(client: pg.PoolClient, setId: string, scriptId: string): Promise<ScriptDoc | null> {
  if (!isUuid(scriptId)) return null;
  const result = await client.query<ScriptDoc>(
    `select id, name, version, source, asset_ids from scripts where set_id = $1 and id = $2`,
    [setId, scriptId],
  );
  return result.rows[0] ?? null;
}

export async function applyScriptAdd(ctx: ApplyContext): Promise<Applied> {
  if (!isUuid(ctx.target)) throw fieldError('target', 'Target must be a new script id');
  const taken = await ctx.client.query(`select 1 from scripts where id = $1`, [ctx.target]);
  if ((taken.rowCount ?? 0) > 0) throw new ApiError(409, 'id_taken', 'That script id is already in use');
  const name = textInLength('name', ctx.payload['name'], 1, 60, 'Script name');
  const source = sourceText('source', ctx.payload['source']);
  await ctx.client.query(
    `insert into scripts (id, set_id, name, version, source, asset_ids) values ($1, $2, $3, 1, $4, '{}')`,
    [ctx.target, ctx.setId, name, source],
  );
  return { version: 1, summary: `Added script ${name}` };
}

export async function applyScriptSave(ctx: ApplyContext): Promise<Applied> {
  const script = await readScript(ctx.client, ctx.setId, ctx.target);
  if (script === null) throw Err.notFound();
  await checkBaseVersion(ctx, script.version, script);
  const source = sourceText('source', ctx.payload['source']);
  const assetIds = asStringArray(ctx.payload['asset_ids']);
  if (assetIds === null) throw fieldError('asset_ids', 'Choose ready texture assets');
  for (const assetId of assetIds) {
    const ok =
      isUuid(assetId) &&
      ((
        await ctx.client.query(
          `select 1 from assets where id = $1 and set_id = $2 and kind = 'texture' and status = 'ready'`,
          [assetId, ctx.setId],
        )
      ).rowCount ?? 0) > 0;
    if (!ok) throw fieldError('asset_ids', 'Choose ready texture assets');
  }
  await ctx.client.query(`update scripts set source = $2, asset_ids = $3 where id = $1`, [
    script.id,
    source,
    [...new Set(assetIds)],
  ]);
  const version = await bumpScript(ctx, script.id);
  return { version, summary: `Saved script ${script.name} version ${version}` };
}

export async function applyScriptRemove(ctx: ApplyContext): Promise<Applied> {
  const script = await readScript(ctx.client, ctx.setId, ctx.target);
  if (script === null) throw Err.notFound();
  await checkBaseVersion(ctx, script.version, script);
  await ctx.client.query(`delete from scripts where id = $1`, [script.id]);
  return { version: script.version + 1, summary: `Removed script ${script.name}` };
}
