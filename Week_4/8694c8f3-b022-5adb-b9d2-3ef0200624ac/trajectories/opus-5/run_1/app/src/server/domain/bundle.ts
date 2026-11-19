import type { Db } from '../db.js';
import { dependentsBySet, loadSetRow, readGraph, readKeys, readLayers, readScripts } from './document.js';
import type { AssetKind, ExportBundle, ShowBundle } from '../../shared/types.js';

interface AssetRow {
  id: string;
  name: string;
  kind: AssetKind;
  size: number;
  sha256: string;
  status: string;
}

interface ShaderRow {
  layer_id: string;
  number: number;
  source: string;
  restored_from: number | null;
}

/** The frozen show bundle: the working set at this moment, UTF-8 JSON. */
export async function buildShowBundle(db: Db, setId: string): Promise<{ bundle: ShowBundle; bytes: Buffer }> {
  const row = await loadSetRow(db, setId);
  const layers = await readLayers(db, setId);
  const keys = await readKeys(db, setId);
  const graph = await readGraph(db, setId, row.graph_version);
  const scripts = await readScripts(db, setId);
  const shaders = await db.query<ShaderRow>(
    `select distinct on (layer_id) layer_id, number, source, restored_from
       from shader_versions where set_id = $1 order by layer_id, number desc`,
    [setId],
  );
  const assets = await referencedAssets(db, setId);
  const bundle: ShowBundle = {
    format: 'afterglass-show/1',
    set: { name: row.name, bpm: row.bpm, active_camera_id: row.active_camera_id },
    layers,
    keys,
    graph,
    shaders: shaders.rows.map((shader) => ({
      layer_id: shader.layer_id,
      version: shader.number,
      source: shader.source,
    })),
    scripts,
    assets,
  };
  return { bundle, bytes: Buffer.from(JSON.stringify(bundle), 'utf8') };
}

/** The export bundle carries every shader's full version history. */
export async function buildExportBundle(db: Db, setId: string): Promise<ExportBundle> {
  const { bundle } = await buildShowBundle(db, setId);
  const shaders = await db.query<ShaderRow>(
    `select layer_id, number, source, restored_from from shader_versions
      where set_id = $1 order by layer_id, number`,
    [setId],
  );
  return {
    ...bundle,
    format: 'afterglass-export/1',
    shaders: shaders.rows.map((shader) => ({
      layer_id: shader.layer_id,
      version: shader.number,
      source: shader.source,
      restored_from: shader.restored_from,
    })),
  };
}

export async function referencedAssets(
  db: Db,
  setId: string,
): Promise<{ id: string; name: string; kind: AssetKind; size: number; sha256: string }[]> {
  const dependents = await dependentsBySet(db, setId);
  const rows = await db.query<AssetRow>(
    `select id, name, kind, size, sha256, status from assets where set_id = $1 and status = 'ready' order by created_at, id`,
    [setId],
  );
  return rows.rows
    .filter((row) => (dependents.get(row.id)?.count ?? 0) > 0)
    .map((row) => ({ id: row.id, name: row.name, kind: row.kind, size: row.size, sha256: row.sha256 }));
}

export async function readyAssetRows(db: Db, setId: string): Promise<AssetRow[]> {
  const rows = await db.query<AssetRow>(
    `select id, name, kind, size, sha256, status from assets where set_id = $1 and status = 'ready' order by created_at, id`,
    [setId],
  );
  return rows.rows;
}

export async function unreadyReferences(db: Db, setId: string): Promise<boolean> {
  const layers = await readLayers(db, setId);
  const scripts = await readScripts(db, setId);
  const referenced = new Set<string>();
  for (const layer of layers) {
    if (layer.model_asset_id !== null) referenced.add(layer.model_asset_id);
    if (layer.material?.albedo_texture_id != null) referenced.add(layer.material.albedo_texture_id);
    if (layer.material?.emissive_texture_id != null) referenced.add(layer.material.emissive_texture_id);
  }
  for (const script of scripts) for (const assetId of script.asset_ids) referenced.add(assetId);
  if (referenced.size === 0) return false;
  const rows = await db.query<{ count: number }>(
    `select count(*)::int as count from assets where set_id = $1 and id = any($2::uuid[]) and status <> 'ready'`,
    [setId, [...referenced]],
  );
  return (rows.rows[0]?.count ?? 0) > 0;
}
