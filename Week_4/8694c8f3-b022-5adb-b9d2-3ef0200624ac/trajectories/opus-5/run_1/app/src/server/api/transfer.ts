import { randomUUID } from 'node:crypto';
import { unzipSync, zipSync } from 'fflate';
import { pool, withTransaction } from '../db.js';
import { Err, fieldError } from '../errors.js';
import type { Ctx, Reply } from '../http.js';
import { isUuid, requireEditor, requireMembership, requireUser } from '../access.js';
import { parseMultipart, sniff } from '../multipart.js';
import { getObject, keys, putAndConfirm, sha256Hex } from '../storage.js';
import { buildExportBundle, readyAssetRows } from '../domain/bundle.js';
import { writeActivity } from '../domain/activitylog.js';
import { readSetDocument } from '../domain/document.js';
import { asNumber, asRecord, asString, asStringArray } from '../input.js';
import { COPY, LAYER_KINDS, OUTPUT_BUSES, type LayerKind, type OutputBus } from '../../shared/domain.js';
import type { ExportBundle } from '../../shared/types.js';

export async function createExport(ctx: Ctx): Promise<Reply> {
  const membership = requireEditor(await requireMembership(ctx, ctx.params['id'] ?? ''));
  const bundle = await buildExportBundle(pool, membership.setId);
  const assets = await readyAssetRows(pool, membership.setId);
  const files: Record<string, Uint8Array> = {
    'set.json': new Uint8Array(Buffer.from(JSON.stringify(bundle), 'utf8')),
  };
  for (const asset of assets) {
    const bytes = await getObject(keys.asset(membership.setId, asset.id));
    files[`assets/${asset.id}`] = new Uint8Array(bytes);
  }
  const zip = Buffer.from(zipSync(files, { level: 0, mtime: new Date(Date.UTC(1980, 0, 1)) }));
  const exportId = randomUUID();
  const digest = await putAndConfirm(keys.exportZip(membership.setId, exportId), zip, 'application/zip');
  await pool.query(
    `insert into exports (id, set_id, sha256, size, created_by) values ($1, $2, $3, $4, $5)`,
    [exportId, membership.setId, digest, zip.length, membership.user.id],
  );
  await writeActivity(
    pool,
    membership.setId,
    membership.user.id,
    'set.export',
    exportId,
    `Exported the set as ${zip.length} bytes`,
  );
  return {
    status: 201,
    json: {
      export: {
        id: exportId,
        sha256: digest,
        size: zip.length,
        download_url: `/api/exports/${exportId}/download`,
      },
    },
  };
}

function exportFilename(setName: string): string {
  return `${setName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.afterglass.zip`;
}

export async function downloadExport(ctx: Ctx): Promise<Reply> {
  const user = await requireUser(ctx);
  const exportId = ctx.params['exportId'] ?? '';
  if (!isUuid(exportId)) throw Err.notFound();
  const found = await pool.query<{ set_id: string; sha256: string; name: string }>(
    `select e.set_id, e.sha256, s.name
       from exports e
       join sets s on s.id = e.set_id
       join set_members m on m.set_id = e.set_id and m.user_id = $2
      where e.id = $1`,
    [exportId, user.id],
  );
  const row = found.rows[0];
  if (row === undefined) throw Err.notFound();
  const bytes = await getObject(keys.exportZip(row.set_id, exportId));
  return {
    status: 200,
    body: bytes,
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${exportFilename(row.name)}"`,
      'X-Content-SHA256': row.sha256,
    },
  };
}

interface ImportedLayer {
  id: string;
  parent_id: string | null;
  index: number;
  name: string;
  kind: LayerKind;
  visible: boolean;
  position: number[];
  rotation: number[];
  scale: number[];
  props: Record<string, number>;
  material: unknown;
  model_asset_id: string | null;
  output_buses: OutputBus[];
}

function readBundle(bytes: Buffer): ExportBundle {
  if (sniff(bytes) !== 'zip') throw fieldError('file', COPY.notAnExport);
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(new Uint8Array(bytes));
  } catch {
    throw fieldError('file', COPY.notAnExport);
  }
  const setJson = entries['set.json'];
  if (setJson === undefined) throw fieldError('file', COPY.notAnExport);
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(setJson).toString('utf8'));
  } catch {
    throw fieldError('file', COPY.notAnExport);
  }
  const record = asRecord(parsed);
  if (record === null || asString(record['format']) !== 'afterglass-export/1') {
    throw fieldError('file', COPY.notAnExport);
  }
  return parsed as ExportBundle;
}

function layersFrom(bundle: ExportBundle): ImportedLayer[] {
  const layers: ImportedLayer[] = [];
  for (const entry of bundle.layers) {
    const kind = (LAYER_KINDS as readonly string[]).includes(entry.kind) ? entry.kind : null;
    if (kind === null) throw fieldError('file', COPY.notAnExport);
    layers.push({
      id: entry.id,
      parent_id: entry.parent_id,
      index: entry.index,
      name: entry.name,
      kind: entry.kind,
      visible: entry.visible,
      position: entry.position,
      rotation: entry.rotation,
      scale: entry.scale,
      props: entry.props,
      material: entry.material,
      model_asset_id: entry.model_asset_id,
      output_buses: entry.output_buses.filter((bus) => (OUTPUT_BUSES as readonly string[]).includes(bus)),
    });
  }
  return layers;
}

export async function importSet(ctx: Ctx): Promise<Reply> {
  const body = await parseMultipart(ctx);
  const user = await requireUser(ctx);
  const file = body.files.find((entry) => entry.field === 'file');
  if (file === undefined || file.bytes.length === 0) throw fieldError('file', COPY.notAnExport);

  const importId = randomUUID();
  await putAndConfirm(keys.importZip(importId), file.bytes, 'application/zip');

  const bundle = readBundle(file.bytes);
  const entries = unzipSync(new Uint8Array(file.bytes));
  const layers = layersFrom(bundle);

  const setId = randomUUID();
  const layerIds = new Map<string, string>();
  for (const layer of layers) layerIds.set(layer.id, randomUUID());
  const assetIds = new Map<string, string>();
  for (const asset of bundle.assets) assetIds.set(asset.id, randomUUID());

  for (const asset of bundle.assets) {
    const bytes = entries[`assets/${asset.id}`];
    if (bytes === undefined) throw fieldError('file', COPY.notAnExport);
    const newId = assetIds.get(asset.id) as string;
    const contentType =
      asset.kind === 'model' ? 'model/gltf-binary' : sniff(Buffer.from(bytes)) === 'jpeg' ? 'image/jpeg' : 'image/png';
    await putAndConfirm(keys.asset(setId, newId), Buffer.from(bytes), contentType);
  }

  await withTransaction(async (client) => {
    const name = `${bundle.set.name} (imported)`;
    const bpm = asNumber(bundle.set.bpm) ?? 120;
    await client.query(
      `insert into sets (id, name, bpm, owner_id, head, settings_version, graph_version, show_token)
       values ($1, $2, $3, $4, 0, 1, 1, $5)`,
      [setId, name.slice(0, 80), bpm, user.id, randomUUID().replaceAll('-', '')],
    );
    await client.query(
      `insert into set_members (set_id, user_id, role, join_order) values ($1, $2, 'owner', 0)`,
      [setId, user.id],
    );
    for (const asset of bundle.assets) {
      const newId = assetIds.get(asset.id) as string;
      const contentType = asset.kind === 'model' ? 'model/gltf-binary' : 'image/png';
      await client.query(
        `insert into assets (id, set_id, name, kind, content_type, size, sha256, status, uploaded_by)
         values ($1, $2, $3, $4, $5, $6, $7, 'ready', $8)`,
        [newId, setId, asset.name, asset.kind, contentType, asset.size, asset.sha256, user.id],
      );
    }
    for (const layer of layers) {
      const material = asRecord(layer.material);
      const remapped =
        material === null
          ? null
          : {
              tint: material['tint'],
              tint_alpha: material['tint_alpha'],
              albedo_texture_id: assetIds.get(asString(material['albedo_texture_id']) ?? '') ?? null,
              emissive_texture_id: assetIds.get(asString(material['emissive_texture_id']) ?? '') ?? null,
            };
      await client.query(
        `insert into layers (id, set_id, parent_id, idx, name, kind, version, visible, position, rotation, scale,
                             props, material, model_asset_id, output_buses, shader_version)
         values ($1, $2, $3, $4, $5, $6, 1, $7, $8, $9, $10, $11, $12, $13, $14, null)`,
        [
          layerIds.get(layer.id),
          setId,
          layer.parent_id === null ? null : layerIds.get(layer.parent_id) ?? null,
          layer.index,
          layer.name,
          layer.kind,
          layer.visible,
          layer.position,
          layer.rotation,
          layer.scale,
          JSON.stringify(layer.props),
          remapped === null ? null : JSON.stringify(remapped),
          layer.model_asset_id === null ? null : assetIds.get(layer.model_asset_id) ?? null,
          layer.output_buses,
        ],
      );
    }
    for (const key of bundle.keys) {
      const layerId = layerIds.get(key.layer_id);
      if (layerId === undefined) continue;
      await client.query(
        `insert into keys (set_id, layer_id, property, tick, value) values ($1, $2, $3, $4, $5)`,
        [setId, layerId, key.property, key.tick, key.value],
      );
    }
    for (const shader of bundle.shaders) {
      const layerId = layerIds.get(shader.layer_id);
      if (layerId === undefined) continue;
      await client.query(
        `insert into shader_versions (set_id, layer_id, number, source, sha256, size, author_id, restored_from)
         values ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          setId,
          layerId,
          shader.version,
          shader.source,
          sha256Hex(shader.source),
          Buffer.byteLength(shader.source, 'utf8'),
          user.id,
          shader.restored_from ?? null,
        ],
      );
      await client.query(
        `update layers set shader_version = greatest(coalesce(shader_version, 0), $2) where id = $1`,
        [layerId, shader.version],
      );
    }
    const nodeIds = new Map<string, string>();
    for (const node of bundle.graph.nodes) nodeIds.set(node.node_id, randomUUID());
    for (const node of bundle.graph.nodes) {
      const params: Record<string, string | number> = { ...node.params };
      const layerParam = asString(params['layer_id']);
      if (layerParam !== null) params['layer_id'] = layerIds.get(layerParam) ?? layerParam;
      await client.query(
        `insert into graph_nodes (set_id, node_id, type, params, x, y) values ($1, $2, $3, $4, $5, $6)`,
        [setId, nodeIds.get(node.node_id), node.type, JSON.stringify(params), node.x, node.y],
      );
    }
    for (const wire of bundle.graph.wires) {
      const fromNode = nodeIds.get(wire.from.node_id);
      const toNode = nodeIds.get(wire.to.node_id);
      if (fromNode === undefined || toNode === undefined) continue;
      await client.query(
        `insert into graph_wires (set_id, wire_id, from_node, from_port, to_node, to_port)
         values ($1, $2, $3, $4, $5, $6)`,
        [setId, randomUUID(), fromNode, wire.from.port, toNode, wire.to.port],
      );
    }
    for (const script of bundle.scripts) {
      const ids = asStringArray(script.asset_ids) ?? [];
      await client.query(
        `insert into scripts (id, set_id, name, version, source, asset_ids) values ($1, $2, $3, $4, $5, $6)`,
        [
          randomUUID(),
          setId,
          script.name,
          script.version,
          script.source,
          ids.map((assetId) => assetIds.get(assetId)).filter((value): value is string => value !== undefined),
        ],
      );
    }
    const activeCamera = bundle.set.active_camera_id;
    if (activeCamera !== null && layerIds.has(activeCamera)) {
      await client.query(`update sets set active_camera_id = $2 where id = $1`, [
        setId,
        layerIds.get(activeCamera),
      ]);
    }
    await writeActivity(client, setId, user.id, 'set.import', setId, `Imported ${bundle.set.name}`);
  });

  const document = await readSetDocument(pool, setId, 'owner');
  return { status: 201, json: document };
}
