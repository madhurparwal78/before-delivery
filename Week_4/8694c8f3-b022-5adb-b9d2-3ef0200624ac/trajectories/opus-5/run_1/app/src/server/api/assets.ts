import { randomUUID } from 'node:crypto';
import { pool } from '../db.js';
import { ApiError, Err, fieldError } from '../errors.js';
import { LIMITS, type Ctx, type Reply } from '../http.js';
import { parseMultipart, sniff } from '../multipart.js';
import { isUuid, requireEditor, requireMembership, requireOwner, requireUser } from '../access.js';
import { deleteObject, getObject, keys, putAndConfirm, sha256Hex, storageHealthy } from '../storage.js';
import { dependentsBySet, emptyDependents } from '../domain/document.js';
import { writeActivity } from '../domain/activitylog.js';
import type { AssetDoc, AssetKind, AssetStatus } from '../../shared/types.js';

interface AssetRow {
  id: string;
  set_id: string;
  name: string;
  kind: AssetKind;
  content_type: string;
  size: number;
  sha256: string;
  status: AssetStatus;
  created_at: Date;
}

export async function uploadAsset(ctx: Ctx): Promise<Reply> {
  const body = await parseMultipart(ctx);
  const file = body.files.find((entry) => entry.field === 'file');
  const kindText = body.fields['kind'] ?? '';
  if (kindText === 'texture' && file !== undefined && file.bytes.length > LIMITS.texture) {
    throw Err.tooLarge();
  }

  const membership = requireEditor(await requireMembership(ctx, ctx.params['id'] ?? ''));
  if (kindText !== 'model' && kindText !== 'texture') throw fieldError('kind', 'Choose model or texture');
  if (file === undefined || file.bytes.length === 0) throw fieldError('file', 'Choose a GLB or texture file');
  const kind: AssetKind = kindText;
  const sniffed = sniff(file.bytes);
  const contentType =
    sniffed === 'glb' ? 'model/gltf-binary' : sniffed === 'png' ? 'image/png' : 'image/jpeg';
  if (kind === 'model' && sniffed !== 'glb') throw fieldError('file', 'Models must be binary glTF 2.0 (.glb)');
  if (kind === 'texture' && sniffed !== 'png' && sniffed !== 'jpeg') {
    throw fieldError('file', 'Textures must be PNG or JPEG');
  }

  const id = randomUUID();
  const name = file.filename === '' ? `asset-${id}` : file.filename;
  const digest = sha256Hex(file.bytes);
  await pool.query(
    `insert into assets (id, set_id, name, kind, content_type, size, sha256, status, uploaded_by)
     values ($1, $2, $3, $4, $5, $6, $7, 'uploading', $8)`,
    [id, membership.setId, name, kind, contentType, file.bytes.length, digest, membership.user.id],
  );

  try {
    await putAndConfirm(keys.asset(membership.setId, id), file.bytes, contentType);
  } catch (error) {
    await pool.query(`update assets set status = 'upload failed' where id = $1`, [id]);
    const failed: AssetDoc = {
      id,
      name,
      kind,
      size: file.bytes.length,
      sha256: digest,
      status: 'upload failed',
      created_at: new Date().toISOString(),
      dependents: emptyDependents(),
    };
    if (error instanceof ApiError && error.status === 503) {
      throw new ApiError(503, 'storage_unavailable', error.message, { asset: failed });
    }
    throw error;
  }

  await pool.query(`update assets set status = 'ready' where id = $1`, [id]);
  await writeActivity(pool, membership.setId, membership.user.id, 'asset.upload', id, `Uploaded ${name}`);
  const asset: AssetDoc = {
    id,
    name,
    kind,
    size: file.bytes.length,
    sha256: digest,
    status: 'ready',
    created_at: new Date().toISOString(),
    dependents: emptyDependents(),
  };
  return { status: 201, json: { asset } };
}

export async function listAssets(ctx: Ctx): Promise<Reply> {
  const membership = await requireMembership(ctx, ctx.params['id'] ?? '');
  const rows = await pool.query<AssetRow>(
    `select id, set_id, name, kind, content_type, size, sha256, status, created_at
       from assets where set_id = $1 order by created_at, id`,
    [membership.setId],
  );
  const dependents = await dependentsBySet(pool, membership.setId);
  const assets: AssetDoc[] = rows.rows.map((row) => ({
    id: row.id,
    name: row.name,
    kind: row.kind,
    size: row.size,
    sha256: row.sha256,
    status: row.status,
    created_at: row.created_at.toISOString(),
    dependents: dependents.get(row.id) ?? emptyDependents(),
  }));
  return { status: 200, json: { assets } };
}

export async function getAssetContent(ctx: Ctx): Promise<Reply> {
  const user = await requireUser(ctx);
  const assetId = ctx.params['assetId'] ?? '';
  if (!isUuid(assetId)) throw Err.notFound();
  const found = await pool.query<AssetRow & { role: string }>(
    `select a.id, a.set_id, a.name, a.kind, a.content_type, a.size, a.sha256, a.status, a.created_at, m.role
       from assets a join set_members m on m.set_id = a.set_id and m.user_id = $2
      where a.id = $1`,
    [assetId, user.id],
  );
  const asset = found.rows[0];
  if (asset === undefined) throw Err.notFound();
  if (asset.status !== 'ready') throw new ApiError(409, 'asset_not_ready', 'This asset is not ready');
  const bytes = await getObject(keys.asset(asset.set_id, asset.id));
  return {
    status: 200,
    body: bytes,
    headers: { 'Content-Type': asset.content_type, 'X-Content-SHA256': asset.sha256 },
  };
}

export async function deleteAsset(ctx: Ctx): Promise<Reply> {
  const membership = requireOwner(await requireMembership(ctx, ctx.params['id'] ?? ''));
  const assetId = ctx.params['assetId'] ?? '';
  if (!isUuid(assetId)) throw Err.notFound();
  const found = await pool.query<AssetRow>(
    `select id, set_id, name, kind, content_type, size, sha256, status, created_at
       from assets where id = $1 and set_id = $2`,
    [assetId, membership.setId],
  );
  const asset = found.rows[0];
  if (asset === undefined) throw Err.notFound();
  if (!storageHealthy()) throw Err.storageUnavailable();

  const dependents = (await dependentsBySet(pool, membership.setId)).get(assetId);
  if (dependents !== undefined && dependents.count > 0) {
    throw new ApiError(409, 'asset_in_use', `${asset.name} is still in use`, { dependents });
  }
  const shows = await pool.query<{ number: number }>(
    `select number from show_versions
      where set_id = $1 and status in ('published','storing') and $2 = any(asset_ids)
      order by number`,
    [membership.setId, assetId],
  );
  if (shows.rows.length > 0) {
    throw new ApiError(409, 'asset_in_shows', `${asset.name} is part of published show versions`, {
      show_versions: shows.rows.map((row) => row.number),
    });
  }

  await deleteObject(keys.asset(membership.setId, assetId));
  await pool.query(`delete from assets where id = $1`, [assetId]);
  await writeActivity(
    pool,
    membership.setId,
    membership.user.id,
    'asset.delete',
    assetId,
    `Deleted ${asset.name}`,
  );
  return { status: 204 };
}
