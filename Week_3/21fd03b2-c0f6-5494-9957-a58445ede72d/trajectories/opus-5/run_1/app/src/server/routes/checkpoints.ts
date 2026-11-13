import { createHash } from 'node:crypto';
import type { CheckpointRow } from '../../shared/api.js';
import { fieldCopy } from '../../shared/copy.js';
import { objectFieldKeys, parseDocument } from '../../shared/scene.js';
import { stepZeroHash } from '../../shared/sim.js';
import { canEditScenes, sceneCheckpointEdge } from '../../shared/states.js';
import { one, query, transaction } from '../db.js';
import { faults } from '../errors.js';
import { newId } from '../ids.js';
import { created, ok, raw, type Ctx, type Reply, type Route } from '../http.js';
import { listLeases } from '../locks.js';
import { readString, recordActivity, requireScene } from '../repo.js';
import { StorageDown, getObject, putObject, storageKeys } from '../s3.js';

interface CheckpointDbRow {
  id: string;
  scene_id: string;
  label: string;
  revision: number;
  state_hash: string;
  document_sha256: string;
  created_at: Date;
}

function checkpointJson(row: CheckpointDbRow): CheckpointRow {
  return {
    id: row.id,
    label: row.label,
    revision: row.revision,
    stateHash: row.state_hash,
    documentSha256: row.document_sha256,
    createdAt: row.created_at.toISOString(),
  };
}

async function createCheckpoint(ctx: Ctx): Promise<Reply> {
  const account = await ctx.requireAccount();
  const found = await requireScene(ctx.params.sid, account.id);
  if (!canEditScenes(found.role)) throw faults.forbidden();
  const label = readString(ctx.body(), 'label').trim();
  if ([...label].length < 1 || [...label].length > 60)
    throw faults.validation({ label: fieldCopy.name });
  const folded = label.toLowerCase();
  const clash = await one<{ id: string }>(
    'select id from checkpoints where scene_id = $1 and label_folded = $2',
    [found.scene.id, folded],
  );
  if (clash) throw faults.checkpointNameTaken();

  const bytes = new TextEncoder().encode(found.scene.document);
  const documentSha256 = createHash('sha256').update(bytes).digest('hex');
  const id = newId();
  try {
    await putObject(storageKeys.checkpoint(found.scene.id, id), bytes, 'application/json');
  } catch (error) {
    if (error instanceof StorageDown) throw faults.storageUnavailable();
    throw error;
  }

  const rows = await query<CheckpointDbRow>(
    `insert into checkpoints (id, scene_id, label, label_folded, revision, state_hash, document_sha256)
     values ($1,$2,$3,$4,$5,$6,$7)
     returning id, scene_id, label, revision, state_hash, document_sha256, created_at`,
    [
      id,
      found.scene.id,
      label,
      folded,
      found.scene.revision,
      found.scene.state_hash,
      documentSha256,
    ],
  );
  const nextStatus = sceneCheckpointEdge(found.scene.status);
  if (nextStatus !== found.scene.status)
    await query('update scenes set status = $1 where id = $2', [nextStatus, found.scene.id]);
  await recordActivity(found.workspaceId, account.id, 'checkpoint.created', label);
  return created({ checkpoint: checkpointJson(rows[0]) });
}

async function listCheckpoints(ctx: Ctx): Promise<Reply> {
  const account = await ctx.requireAccount();
  const found = await requireScene(ctx.params.sid, account.id);
  const rows = await query<CheckpointDbRow>(
    `select id, scene_id, label, revision, state_hash, document_sha256, created_at
       from checkpoints where scene_id = $1 order by created_at desc`,
    [found.scene.id],
  );
  return ok({ checkpoints: rows.map(checkpointJson) });
}

async function checkpointDocument(ctx: Ctx): Promise<Reply> {
  const account = await ctx.requireAccount();
  const found = await requireScene(ctx.params.sid, account.id);
  const row = await one<CheckpointDbRow>(
    `select id, scene_id, label, revision, state_hash, document_sha256, created_at
       from checkpoints where id = $1 and scene_id = $2`,
    [ctx.params.cid, found.scene.id],
  );
  if (!row) throw faults.notFound();
  let bytes: Uint8Array | null;
  try {
    bytes = await getObject(storageKeys.checkpoint(found.scene.id, row.id));
  } catch (error) {
    if (error instanceof StorageDown) throw faults.storageUnavailable();
    throw error;
  }
  if (!bytes) throw faults.notFound();
  return raw(bytes, 'application/json');
}

async function restoreCheckpoint(ctx: Ctx): Promise<Reply> {
  const account = await ctx.requireAccount();
  const found = await requireScene(ctx.params.sid, account.id);
  if (!canEditScenes(found.role)) throw faults.forbidden();
  const row = await one<CheckpointDbRow>(
    `select id, scene_id, label, revision, state_hash, document_sha256, created_at
       from checkpoints where id = $1 and scene_id = $2`,
    [ctx.params.cid, found.scene.id],
  );
  if (!row) throw faults.notFound();

  const leases = await listLeases(found.scene.id);
  const others = leases.filter((lease) => lease.holder.userId !== account.id);
  if (others.length > 0)
    throw faults.locksHeld(
      others.map((lease) => ({
        userId: lease.holder.userId,
        displayName: lease.holder.displayName,
      })),
    );

  let bytes: Uint8Array | null;
  try {
    bytes = await getObject(storageKeys.checkpoint(found.scene.id, row.id));
  } catch (error) {
    if (error instanceof StorageDown) throw faults.storageUnavailable();
    throw error;
  }
  if (!bytes) throw faults.storageUnavailable();

  const text = new TextDecoder().decode(bytes);
  const document = parseDocument(text);
  const stateHash = stepZeroHash(document);
  const changedKeys = new Set<string>(['scene.name', 'scene.gravity']);
  for (const object of document.objects) for (const key of objectFieldKeys(object)) changedKeys.add(key);
  for (const object of parseDocument(found.scene.document).objects)
    for (const key of objectFieldKeys(object)) changedKeys.add(key);

  const revision = await transaction(async (run) => {
    const rows = await run<{ revision: number }>(
      'select revision from scenes where id = $1 for update',
      [found.scene.id],
    );
    const next = rows[0].revision + 1;
    await run(
      `insert into revisions (scene_id, revision, document, ops, changed_keys, state_hash)
       values ($1,$2,$3,$4,$5,$6)`,
      [found.scene.id, next, text, JSON.stringify([]), [...changedKeys], stateHash],
    );
    await run(
      `update scenes set revision = $1, document = $2, state_hash = $3, name = $4,
              restore_revision = $1, updated_at = now() where id = $5`,
      [next, text, stateHash, document.name, found.scene.id],
    );
    return next;
  });
  await recordActivity(found.workspaceId, account.id, 'checkpoint.restored', row.label);
  return ok({ revision, stateHash });
}

export const checkpointRoutes: readonly Route[] = [
  { method: 'POST', pattern: '/api/scenes/:sid/checkpoints', handler: createCheckpoint },
  { method: 'GET', pattern: '/api/scenes/:sid/checkpoints', handler: listCheckpoints },
  {
    method: 'GET',
    pattern: '/api/scenes/:sid/checkpoints/:cid/document',
    handler: checkpointDocument,
  },
  {
    method: 'POST',
    pattern: '/api/scenes/:sid/checkpoints/:cid/restore',
    handler: restoreCheckpoint,
  },
];
