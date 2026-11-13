import type { LabBundle } from '../../shared/api.js';
import { MAX_EXPOSED, buildBundle, exposableKeys, exposedParameters } from '../../shared/bundle.js';
import { fieldCopy } from '../../shared/copy.js';
import { parseDocument } from '../../shared/scene.js';
import { simulateHash } from '../../shared/sim.js';
import { canAdminister, scenePublishEdge, sceneUnpublishEdge } from '../../shared/states.js';
import { publicAddress } from '../config.js';
import { one, query } from '../db.js';
import { faults } from '../errors.js';
import { newToken } from '../ids.js';
import { created, ok, raw, type Ctx, type Reply, type Route } from '../http.js';
import { publishMessage, queueMessage } from '../mailer.js';
import { recordActivity, requireScene, sceneRecord, sceneById, type AssetDbRow } from '../repo.js';
import { StorageDown, getObject, putObject, storageKeys } from '../s3.js';
import { parseVerifyRequest } from '../verify.js';

interface LabDbRow {
  scene_id: string;
  token: string;
  bundle_hash: string;
  published_at: Date;
  checkpoint_id: string;
  exposed: string[];
  active: boolean;
}

async function publish(ctx: Ctx): Promise<Reply> {
  const account = await ctx.requireAccount();
  const found = await requireScene(ctx.params.sid, account.id);
  if (!canAdminister(found.role)) throw faults.forbidden();
  if (scenePublishEdge(found.scene.status) === 'no_checkpoint') throw faults.noCheckpoint();

  const body = ctx.body();
  const checkpointId = typeof body.checkpointId === 'string' ? body.checkpointId : '';
  const exposedValue = body.exposed;
  const exposed = Array.isArray(exposedValue)
    ? exposedValue.filter((key): key is string => typeof key === 'string')
    : [];
  const checkpoint = await one<{ id: string }>(
    'select id from checkpoints where id = $1 and scene_id = $2',
    [checkpointId, found.scene.id],
  );
  if (!checkpoint) throw faults.validation({ exposed: fieldCopy.exposed });

  let snapshot: Uint8Array | null;
  try {
    snapshot = await getObject(storageKeys.checkpoint(found.scene.id, checkpointId));
  } catch (error) {
    if (error instanceof StorageDown) throw faults.storageUnavailable();
    throw error;
  }
  if (!snapshot) throw faults.storageUnavailable();
  const document = parseDocument(new TextDecoder().decode(snapshot));
  const allowed = new Set(exposableKeys(document));
  if (exposed.length > MAX_EXPOSED || exposed.some((key) => !allowed.has(key)))
    throw faults.validation({ exposed: fieldCopy.exposed });

  const assets = await query<AssetDbRow>(
    `select id, project_id, name, kind, bytes, sha256, unit, scale_to_metres, extent_metres, created_at
       from assets where project_id = $1`,
    [found.scene.project_id],
  );
  const built = buildBundle({
    checkpointId,
    document,
    exposed,
    assets: assets.map((asset) => ({
      assetId: asset.id,
      kind: asset.kind,
      scaleToMetres: asset.scale_to_metres === null ? null : Number(asset.scale_to_metres),
      sha256: asset.sha256,
    })),
  });

  try {
    await putObject(
      storageKeys.bundle(found.scene.id, built.bundleHash),
      built.bytes,
      'application/json',
    );
  } catch (error) {
    if (error instanceof StorageDown) throw faults.storageUnavailable();
    throw error;
  }

  const existing = await one<LabDbRow>(
    'select scene_id, token, bundle_hash, published_at, checkpoint_id, exposed, active from labs where scene_id = $1',
    [found.scene.id],
  );
  const token = existing && existing.active ? existing.token : newToken();
  const publishedAt = new Date();
  await query(
    `insert into labs (scene_id, token, bundle_hash, published_at, checkpoint_id, exposed, active)
     values ($1,$2,$3,$4,$5,$6,true)
     on conflict (scene_id) do update set token = excluded.token, bundle_hash = excluded.bundle_hash,
       published_at = excluded.published_at, checkpoint_id = excluded.checkpoint_id,
       exposed = excluded.exposed, active = true`,
    [
      found.scene.id,
      token,
      built.bundleHash,
      publishedAt.toISOString(),
      checkpointId,
      JSON.stringify(exposed),
    ],
  );
  await query("update scenes set status = 'published' where id = $1", [found.scene.id]);
  await recordActivity(found.workspaceId, account.id, 'scene.published', found.scene.name);
  const delivery = await queueMessage({
    kind: 'publish',
    ...publishMessage({
      email: account.email,
      sceneName: found.scene.name,
      token,
      bundleHash: built.bundleHash,
    }),
  });
  return created({
    lab: {
      token,
      url: publicAddress(`/lab/${token}`),
      bundleHash: built.bundleHash,
      publishedAt: publishedAt.toISOString(),
      checkpointId,
      exposed,
    },
    delivery,
  });
}

async function unpublish(ctx: Ctx): Promise<Reply> {
  const account = await ctx.requireAccount();
  const found = await requireScene(ctx.params.sid, account.id);
  if (!canAdminister(found.role)) throw faults.forbidden();
  if (sceneUnpublishEdge(found.scene.status) === 'not_published') throw faults.notPublished();
  await query('update labs set active = false where scene_id = $1', [found.scene.id]);
  await query("update scenes set status = 'unpublished' where id = $1", [found.scene.id]);
  await recordActivity(found.workspaceId, account.id, 'scene.unpublished', found.scene.name);
  const refreshed = await sceneById(found.scene.id);
  if (!refreshed) throw faults.notFound();
  return ok({ scene: await sceneRecord(refreshed) });
}

async function regenerateLabLink(ctx: Ctx): Promise<Reply> {
  const account = await ctx.requireAccount();
  const found = await requireScene(ctx.params.sid, account.id);
  if (!canAdminister(found.role)) throw faults.forbidden();
  if (found.scene.status !== 'published') throw faults.notPublished();
  const token = newToken();
  const rows = await query<LabDbRow>(
    `update labs set token = $1 where scene_id = $2 and active
     returning scene_id, token, bundle_hash, published_at, checkpoint_id, exposed, active`,
    [token, found.scene.id],
  );
  if (rows.length === 0) throw faults.notPublished();
  await recordActivity(found.workspaceId, account.id, 'lab_link.regenerated', found.scene.name);
  const row = rows[0];
  return ok({
    lab: {
      token: row.token,
      url: publicAddress(`/lab/${row.token}`),
      bundleHash: row.bundle_hash,
      publishedAt: row.published_at.toISOString(),
      checkpointId: row.checkpoint_id,
      exposed: row.exposed,
    },
  });
}

async function liveLab(token: string): Promise<LabDbRow & { scene_name: string }> {
  const row = await one<LabDbRow & { scene_name: string }>(
    `select l.scene_id, l.token, l.bundle_hash, l.published_at, l.checkpoint_id, l.exposed,
            l.active, s.name as scene_name
       from labs l join scenes s on s.id = l.scene_id
      where l.token = $1`,
    [token],
  );
  if (!row || !row.active) throw faults.linkNotFound();
  return row;
}

async function readBundle(row: LabDbRow): Promise<{ bundle: LabBundle; bytes: Uint8Array }> {
  let bytes: Uint8Array | null;
  try {
    bytes = await getObject(storageKeys.bundle(row.scene_id, row.bundle_hash));
  } catch (error) {
    if (error instanceof StorageDown) throw faults.storageUnavailable();
    throw error;
  }
  if (!bytes) throw faults.storageUnavailable();
  return { bundle: JSON.parse(new TextDecoder().decode(bytes)) as LabBundle, bytes };
}

async function getLab(ctx: Ctx): Promise<Reply> {
  const row = await liveLab(ctx.params.token);
  const { bundle } = await readBundle(row);
  return ok({
    lab: {
      sceneName: row.scene_name,
      bundleHash: row.bundle_hash,
      publishedAt: row.published_at.toISOString(),
      exposed: exposedParameters(bundle.document, row.exposed),
    },
    bundle,
  });
}

async function getLabBundle(ctx: Ctx): Promise<Reply> {
  const row = await liveLab(ctx.params.token);
  const { bytes } = await readBundle(row);
  return raw(bytes, 'application/json', { etag: `"${row.bundle_hash}"` });
}

async function getLabAsset(ctx: Ctx): Promise<Reply> {
  const row = await liveLab(ctx.params.token);
  const { bundle } = await readBundle(row);
  const named = bundle.assets.find((asset) => asset.sha256 === ctx.params.sha256);
  if (!named) throw faults.notFound();
  const scene = await sceneById(row.scene_id);
  if (!scene) throw faults.notFound();
  let bytes: Uint8Array | null;
  try {
    bytes = await getObject(storageKeys.asset(scene.project_id, named.sha256));
  } catch (error) {
    if (error instanceof StorageDown) throw faults.storageUnavailable();
    throw error;
  }
  if (!bytes) throw faults.notFound();
  const contentType =
    named.kind === 'glb'
      ? 'model/gltf-binary'
      : named.kind === 'gltf'
        ? 'model/gltf+json'
        : named.kind === 'png'
          ? 'image/png'
          : 'image/jpeg';
  return raw(bytes, contentType, { etag: `"${named.sha256}"` });
}

async function verifyLab(ctx: Ctx): Promise<Reply> {
  const row = await liveLab(ctx.params.token);
  const { bundle } = await readBundle(row);
  const input = parseVerifyRequest(ctx.body(), bundle.document, row.exposed);
  return ok(simulateHash(bundle.document, input.steps, input.params));
}

export const labRoutes: readonly Route[] = [
  { method: 'POST', pattern: '/api/scenes/:sid/publish', handler: publish },
  { method: 'POST', pattern: '/api/scenes/:sid/unpublish', handler: unpublish },
  { method: 'POST', pattern: '/api/scenes/:sid/lab-link/regenerate', handler: regenerateLabLink },
  { method: 'GET', pattern: '/api/labs/:token', handler: getLab, open: true },
  { method: 'GET', pattern: '/api/labs/:token/bundle', handler: getLabBundle, open: true },
  { method: 'GET', pattern: '/api/labs/:token/assets/:sha256', handler: getLabAsset, open: true },
  { method: 'POST', pattern: '/api/labs/:token/verify', handler: verifyLab, open: true },
];
