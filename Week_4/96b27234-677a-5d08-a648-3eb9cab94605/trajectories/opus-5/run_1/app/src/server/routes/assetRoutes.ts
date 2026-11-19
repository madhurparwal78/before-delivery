import { randomUUID } from 'node:crypto';
import { ApiError, SERVICE_TEXT, ServiceDownError, conflict, invalid, notFound } from '../errors.js';
import { personOrThrow, readMultipartBody, route, sendJson } from '../http.js';
import type { RequestContext } from '../http.js';
import { one, query } from '../db.js';
import { worldNow } from '../clock.js';
import type { PersonRow } from '../auth.js';
import { currentPublishedVersion, getAsset, getVersion } from '../assets.js';
import type { AssetRow, VersionRow } from '../assets.js';
import { inspectGlb } from '../domain/glb.js';
import { parseLayout } from '../domain/layout.js';
import type { AssetKind, Measures, Rank, MeasureKey } from '../domain/ranks.js';
import { MEASURE_LABELS, rankOf } from '../domain/ranks.js';
import { parseMultipart } from '../multipart.js';
import { deleteObject, getObject, objectKey, putObject } from '../services/storage.js';

export const UPLOAD_TEXT = {
  kind: 'Choose room or avatar.',
  name: 'Give the model a name of 1 to 80 characters.',
  file: 'Choose a file to upload.',
  layout: 'This room layout is not valid.',
  alreadyPublished: 'This version is already published.',
  inUse: 'This version is in use by an open session.'
} as const;

interface UploadInput {
  kind: AssetKind;
  name: string;
  bytes: Buffer;
  layout: unknown;
}

function layoutJson(raw: string | undefined): unknown {
  if (raw === undefined || raw.trim() === '') return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function readUpload(ctx: RequestContext, known: AssetKind | null): Promise<UploadInput> {
  const raw = await readMultipartBody(ctx);
  const parsed = parseMultipart(raw, ctx.req.headers['content-type']);
  if (parsed === null) throw invalid(UPLOAD_TEXT.file);
  const kind = known ?? (parsed.fields['kind'] as AssetKind | undefined);
  if (kind !== 'room' && kind !== 'avatar') throw invalid(UPLOAD_TEXT.kind);
  let name = '';
  if (known === null) {
    name = parsed.fields['name'] ?? '';
    if (name.length < 1 || name.length > 80) throw invalid(UPLOAD_TEXT.name);
  }
  const file = parsed.files.find((entry) => entry.fieldName === 'file');
  if (file === undefined || file.bytes.length === 0) throw invalid(UPLOAD_TEXT.file);
  let layout: unknown = undefined;
  if (kind === 'room') {
    layout = layoutJson(parsed.fields['layout']);
    if (parseLayout(layout) === null) throw invalid(UPLOAD_TEXT.layout);
  }
  return { kind, name, bytes: file.bytes, layout };
}

interface VersionPayload {
  assetId: string;
  version: number;
  rank: string;
  worstMeasure: string;
  measures: Measures;
  measureRanks: Record<MeasureKey, Rank>;
}

function payloadOf(assetId: string, kind: AssetKind, row: VersionRow): VersionPayload {
  return {
    assetId,
    version: row.version,
    rank: row.rank,
    worstMeasure: MEASURE_LABELS[row.worst_measure],
    measures: row.measures,
    measureRanks: rankOf(kind, row.measures).perMeasure
  };
}

async function storeVersion(
  asset: AssetRow,
  bytes: Buffer,
  rank: string,
  worstMeasure: string,
  measures: Measures,
  layout: unknown,
  status: 'checked' | 'published',
  now: Date
): Promise<VersionRow> {
  const version = asset.last_version + 1;
  await putObject(objectKey(asset.id, version), bytes);
  await query('update assets set last_version = $2 where id = $1', [asset.id, version]);
  await query(
    `insert into asset_versions (asset_id, version, status, rank, worst_measure, measures, layout, created_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [asset.id, version, status, rank, worstMeasure, JSON.stringify(measures), layout === undefined ? null : JSON.stringify(layout), now]
  );
  const row = await getVersion(asset.id, version);
  if (row === null) throw notFound();
  return row;
}

async function ownedAsset(person: PersonRow, assetId: string): Promise<AssetRow> {
  const asset = await getAsset(assetId);
  if (asset === null || asset.world_id !== person.world_id || asset.owner_id !== person.id) throw notFound();
  return asset;
}

route('POST', '/api/assets', 'required', async (ctx) => {
  const person = personOrThrow(ctx);
  const input = await readUpload(ctx, null);
  const inspection = inspectGlb(input.bytes, input.kind);
  if (!inspection.ok) throw new ApiError(inspection.status, inspection.text);
  const now = await worldNow(person.world_id);
  const assetId = randomUUID();
  await query(
    `insert into assets (id, world_id, kind, name, owner_id, last_version, created_at)
     values ($1, $2, $3, $4, $5, 0, $6)`,
    [assetId, person.world_id, input.kind, input.name, person.id, now]
  );
  const asset = await getAsset(assetId);
  if (asset === null) throw notFound();
  try {
    const row = await storeVersion(
      asset,
      input.bytes,
      inspection.ranking.rank,
      inspection.ranking.worstMeasure,
      inspection.measures,
      input.layout,
      'checked',
      now
    );
    sendJson(ctx.res, 201, payloadOf(asset.id, asset.kind, row));
  } catch (error) {
    await query('delete from assets where id = $1', [assetId]);
    throw error;
  }
});

route('POST', '/api/assets/:id/versions', 'required', async (ctx) => {
  const person = personOrThrow(ctx);
  const asset = await ownedAsset(person, ctx.params['id'] ?? '');
  const input = await readUpload(ctx, asset.kind);
  const inspection = inspectGlb(input.bytes, asset.kind);
  if (!inspection.ok) throw new ApiError(inspection.status, inspection.text);
  const now = await worldNow(person.world_id);
  const row = await storeVersion(
    asset,
    input.bytes,
    inspection.ranking.rank,
    inspection.ranking.worstMeasure,
    inspection.measures,
    input.layout,
    'checked',
    now
  );
  sendJson(ctx.res, 201, payloadOf(asset.id, asset.kind, row));
});

route('GET', '/api/assets', 'required', async (ctx) => {
  const person = personOrThrow(ctx);
  const kind = ctx.url.searchParams.get('kind');
  const mine = ctx.url.searchParams.get('mine') === 'true';
  const rows = await query<{
    id: string;
    kind: AssetKind;
    name: string;
    owner_name: string;
    owner_id: string;
  }>(
    `select a.id, a.kind, a.name, p.display_name as owner_name, a.owner_id
       from assets a join people p on p.id = a.owner_id
      where a.world_id = $1 and a.removed = false
        and ($2::text is null or a.kind = $2)
        and ($3::boolean = false or a.owner_id = $4)
      order by a.created_at asc`,
    [person.world_id, kind, mine, person.id]
  );
  const assets = [];
  for (const row of rows) {
    const current = await currentPublishedVersion(row.id);
    if (!mine && current === null) continue;
    assets.push({
      id: row.id,
      kind: row.kind,
      name: row.name,
      ownerName: row.owner_name,
      currentVersion: current?.version ?? null,
      rank: current?.rank ?? null
    });
  }
  sendJson(ctx.res, 200, { assets, total: assets.length });
});

route('GET', '/api/assets/:id', 'required', async (ctx) => {
  const person = personOrThrow(ctx);
  const asset = await getAsset(ctx.params['id'] ?? '');
  if (asset === null || asset.world_id !== person.world_id) throw notFound();
  const owner = asset.owner_id === person.id;
  const rows = await query<VersionRow>(
    `select * from asset_versions where asset_id = $1 ${owner ? '' : `and status = 'published'`} order by version asc`,
    [asset.id]
  );
  const current = await currentPublishedVersion(asset.id);
  const ownerRow = await one<{ display_name: string }>('select display_name from people where id = $1', [
    asset.owner_id
  ]);
  sendJson(ctx.res, 200, {
    id: asset.id,
    kind: asset.kind,
    name: asset.name,
    ownerName: ownerRow?.display_name ?? '',
    currentVersion: current?.version ?? null,
    rank: current?.rank ?? null,
    versions: rows.map((row) => ({
      version: row.version,
      status: row.status,
      rank: row.rank,
      worstMeasure: MEASURE_LABELS[row.worst_measure],
      measures: row.measures,
      measureRanks: rankOf(asset.kind, row.measures).perMeasure,
      ...(asset.kind === 'room' ? { layout: row.layout } : {}),
      createdAt: row.created_at.toISOString()
    }))
  });
});

route('GET', '/api/assets/:id/versions/:n/file', 'required', async (ctx) => {
  const person = personOrThrow(ctx);
  const asset = await getAsset(ctx.params['id'] ?? '');
  if (asset === null || asset.world_id !== person.world_id) throw notFound();
  const version = await getVersion(asset.id, Number(ctx.params['n'] ?? '0'));
  if (version === null) throw notFound();
  if (version.status !== 'published' && asset.owner_id !== person.id) throw notFound();
  let bytes: Uint8Array | null;
  try {
    bytes = await getObject(objectKey(asset.id, version.version));
  } catch (error) {
    if (error instanceof ServiceDownError) throw new ApiError(503, SERVICE_TEXT.storageRead);
    throw error;
  }
  if (bytes === null) throw notFound();
  ctx.res.writeHead(200, {
    'content-type': 'model/gltf-binary',
    'content-length': bytes.length,
    'cache-control': 'no-store'
  });
  ctx.res.end(Buffer.from(bytes));
});

route('POST', '/api/assets/:id/versions/:n/publish', 'required', async (ctx) => {
  const person = personOrThrow(ctx);
  const asset = await ownedAsset(person, ctx.params['id'] ?? '');
  const version = await getVersion(asset.id, Number(ctx.params['n'] ?? '0'));
  if (version === null) throw notFound();
  if (version.status === 'published') throw conflict(UPLOAD_TEXT.alreadyPublished);
  await query(`update asset_versions set status = 'published' where asset_id = $1 and version = $2`, [
    asset.id,
    version.version
  ]);
  sendJson(ctx.res, 200, { assetId: asset.id, version: version.version, status: 'published' });
});

route('POST', '/api/assets/:id/versions/:n/restore', 'required', async (ctx) => {
  const person = personOrThrow(ctx);
  const asset = await ownedAsset(person, ctx.params['id'] ?? '');
  const version = await getVersion(asset.id, Number(ctx.params['n'] ?? '0'));
  if (version === null) throw notFound();
  let bytes: Uint8Array | null;
  try {
    bytes = await getObject(objectKey(asset.id, version.version));
  } catch (error) {
    if (error instanceof ServiceDownError) throw new ApiError(503, SERVICE_TEXT.storageWrite);
    throw error;
  }
  if (bytes === null) throw notFound();
  const now = await worldNow(person.world_id);
  const row = await storeVersion(
    asset,
    Buffer.from(bytes),
    version.rank,
    version.worst_measure,
    version.measures,
    version.layout ?? undefined,
    'published',
    now
  );
  sendJson(ctx.res, 201, payloadOf(asset.id, asset.kind, row));
});

async function versionInUse(assetId: string, version: number): Promise<boolean> {
  const row = await one(
    `select 1 from session_members m join sessions s on s.id = m.session_id
      where s.status = 'open' and m.active = true and s.room_asset_id = $1 and m.room_version = $2`,
    [assetId, version]
  );
  return row !== null;
}

async function removeWholeAsset(asset: AssetRow): Promise<void> {
  const versions = await query<{ version: number }>('select version from asset_versions where asset_id = $1', [
    asset.id
  ]);
  for (const row of versions) {
    if (await versionInUse(asset.id, row.version)) throw conflict(UPLOAD_TEXT.inUse);
  }
  for (const row of versions) await deleteObject(objectKey(asset.id, row.version));
  await query('delete from asset_versions where asset_id = $1', [asset.id]);
  await query('update people set avatar_asset_id = null where avatar_asset_id = $1', [asset.id]);
  await query('update assets set removed = true where id = $1', [asset.id]);
}

route('DELETE', '/api/assets/:id/versions/:n', 'required', async (ctx) => {
  const person = personOrThrow(ctx);
  const asset = await ownedAsset(person, ctx.params['id'] ?? '');
  const version = await getVersion(asset.id, Number(ctx.params['n'] ?? '0'));
  if (version === null) throw notFound();
  if (await versionInUse(asset.id, version.version)) throw conflict(UPLOAD_TEXT.inUse);
  const published = await query<{ version: number }>(
    `select version from asset_versions where asset_id = $1 and status = 'published'`,
    [asset.id]
  );
  if (version.status === 'published' && published.length === 1) {
    await removeWholeAsset(asset);
    sendJson(ctx.res, 200, { status: 'removed' });
    return;
  }
  await deleteObject(objectKey(asset.id, version.version));
  await query('delete from asset_versions where asset_id = $1 and version = $2', [asset.id, version.version]);
  sendJson(ctx.res, 200, { status: 'removed' });
});

route('DELETE', '/api/assets/:id', 'required', async (ctx) => {
  const person = personOrThrow(ctx);
  const asset = await ownedAsset(person, ctx.params['id'] ?? '');
  await removeWholeAsset(asset);
  sendJson(ctx.res, 200, { status: 'removed' });
});
