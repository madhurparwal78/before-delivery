import { createHash } from 'node:crypto';
import type { Json } from '../../shared/canonical.js';
import { fieldCopy } from '../../shared/copy.js';
import {
  applyOps,
  canonicalDocument,
  keysChangedByRevision,
  keysTouchedByOps,
  parseDocument,
  type Op,
  type SceneDocument,
} from '../../shared/scene.js';
import { simulateHash, stepZeroHash } from '../../shared/sim.js';
import { canEditScenes } from '../../shared/states.js';
import { query, transaction } from '../db.js';
import { faults } from '../errors.js';
import { ok, raw, type Ctx, type Reply, type Route } from '../http.js';
import { readLease } from '../locks.js';
import { recordActivity, requireScene, sceneRecord } from '../repo.js';
import { parseVerifyRequest } from '../verify.js';
import { valkey } from '../valkey.js';

async function getScene(ctx: Ctx): Promise<Reply> {
  const account = await ctx.requireAccount();
  const found = await requireScene(ctx.params.sid, account.id);
  return ok({
    scene: await sceneRecord(found.scene),
    document: parseDocument(found.scene.document),
  });
}

async function getDocument(ctx: Ctx): Promise<Reply> {
  const account = await ctx.requireAccount();
  const found = await requireScene(ctx.params.sid, account.id);
  return raw(new TextEncoder().encode(found.scene.document), 'application/json', {
    'x-revision': String(found.scene.revision),
  });
}

function parseOps(body: Record<string, Json>): {
  baseRevision: number;
  changeId: string;
  ops: Op[];
} {
  const fields: Record<string, string> = {};
  const baseRevision = typeof body.baseRevision === 'number' ? body.baseRevision : Number.NaN;
  if (!Number.isInteger(baseRevision) || baseRevision < 1)
    fields.baseRevision = fieldCopy.notANumber;
  const changeId = typeof body.changeId === 'string' ? body.changeId : '';
  if (changeId.length < 8 || changeId.length > 64) fields.changeId = fieldCopy.notANumber;
  const opsValue = body.ops;
  if (!Array.isArray(opsValue) || opsValue.length === 0) fields.ops = fieldCopy.notANumber;
  if (Object.keys(fields).length > 0) throw faults.validation(fields);
  const ops = (opsValue as Json[]).map((entry) => entry as unknown as Op);
  for (const op of ops) {
    if (op.op === 'add' || op.op === 'scene' || op.op === 'set' || op.op === 'remove') continue;
    throw faults.validation({ ops: fieldCopy.notANumber });
  }
  return { baseRevision, changeId, ops };
}

function leaseKeys(ops: readonly Op[]): { objectId: string; fence: number }[] {
  const needed: { objectId: string; fence: number }[] = [];
  for (const op of ops) {
    if (op.op === 'set' || op.op === 'remove')
      needed.push({ objectId: op.objectId, fence: Number(op.fence) });
  }
  return needed;
}

function conflictKeys(ops: readonly Op[], document: SceneDocument): string[] {
  return keysTouchedByOps(
    ops.filter((op) => op.op !== 'add'),
    document,
  );
}

async function patchScene(ctx: Ctx): Promise<Reply> {
  const account = await ctx.requireAccount();
  const found = await requireScene(ctx.params.sid, account.id);
  if (!canEditScenes(found.role)) throw faults.forbidden();
  const body = ctx.body();
  const { baseRevision, changeId, ops } = parseOps(body);
  const requestHash = createHash('sha256')
    .update(JSON.stringify({ baseRevision, ops }))
    .digest('hex');

  const replay = await query<{ revision: number; state_hash: string; request_sha256: string }>(
    'select revision, state_hash, request_sha256 from revisions where scene_id = $1 and change_id = $2',
    [found.scene.id, changeId],
  );
  if (replay.length > 0) {
    if (replay[0].request_sha256 !== requestHash) throw faults.changeIdReused();
    return ok({ revision: replay[0].revision, stateHash: replay[0].state_hash });
  }

  if (!(await valkey.ping())) throw faults.lockStoreUnavailable();

  const result = await transaction(async (run) => {
    const rows = await run<{
      revision: number;
      document: string;
      restore_revision: number;
      name: string;
    }>(
      'select revision, document, restore_revision, name from scenes where id = $1 for update',
      [found.scene.id],
    );
    const current = rows[0];
    const document = parseDocument(current.document);

    const laterKeys = new Set<string>();
    if (baseRevision < current.revision) {
      const later = await run<{ changed_keys: string[] }>(
        'select changed_keys from revisions where scene_id = $1 and revision > $2',
        [found.scene.id, baseRevision],
      );
      for (const revision of later) for (const key of revision.changed_keys) laterKeys.add(key);
    }

    for (const op of ops) {
      if (op.op !== 'set' && op.op !== 'remove') continue;
      if (document.objects.some((object) => object.id === op.objectId)) continue;
      if (laterKeys.has(`${op.objectId}.name`)) {
        const keys = [...laterKeys].filter((key) => key.startsWith(`${op.objectId}.`));
        throw faults.revisionConflict(current.revision, keys.sort());
      }
      throw faults.notFound();
    }

    for (const needed of leaseKeys(ops)) {
      const lease = await readLease(found.scene.id, needed.objectId);
      if (!lease || lease.userId !== account.id || lease.fence !== needed.fence)
        throw faults.staleLock(needed.objectId);
    }

    if (baseRevision < current.restore_revision) {
      throw faults.revisionConflict(
        current.revision,
        keysTouchedByOps(ops, document).sort(),
      );
    }

    const overlap = conflictKeys(ops, document).filter((key) => laterKeys.has(key));
    if (overlap.length > 0) throw faults.revisionConflict(current.revision, overlap.sort());

    const applied = applyOps(document, ops);
    if (!applied.ok) {
      if (applied.failure.kind === 'validation') throw faults.validation(applied.failure.fields);
      throw faults.notFound();
    }

    const nextDocument = applied.document;
    const text = canonicalDocument(nextDocument);
    const stateHash = stepZeroHash(nextDocument);
    const revision = current.revision + 1;
    await run(
      `insert into revisions (scene_id, revision, document, ops, changed_keys, change_id, request_sha256, state_hash)
       values ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        found.scene.id,
        revision,
        text,
        JSON.stringify(ops),
        keysChangedByRevision(ops, document),
        changeId,
        requestHash,
        stateHash,
      ],
    );
    await run(
      'update scenes set revision = $1, document = $2, state_hash = $3, name = $4, updated_at = now() where id = $5',
      [revision, text, stateHash, nextDocument.name, found.scene.id],
    );
    await run('update projects set updated_at = now() where id = $1', [found.scene.project_id]);
    return { revision, stateHash, removed: ops.filter((op) => op.op === 'remove') };
  });

  for (const op of result.removed) {
    if (op.op === 'remove')
      await valkey.command('DEL', `rw:lock:${found.scene.id}:${op.objectId}`).catch(() => undefined);
  }
  await recordActivity(found.workspaceId, account.id, 'scene.edited', found.scene.name);
  return ok({ revision: result.revision, stateHash: result.stateHash });
}

async function verifyScene(ctx: Ctx): Promise<Reply> {
  const account = await ctx.requireAccount();
  const found = await requireScene(ctx.params.sid, account.id);
  const document = parseDocument(found.scene.document);
  const input = parseVerifyRequest(ctx.body(), document, null);
  return ok(simulateHash(document, input.steps, input.params));
}

export const sceneRoutes: readonly Route[] = [
  { method: 'GET', pattern: '/api/scenes/:sid', handler: getScene },
  { method: 'GET', pattern: '/api/scenes/:sid/document', handler: getDocument },
  { method: 'PATCH', pattern: '/api/scenes/:sid', handler: patchScene },
  { method: 'POST', pattern: '/api/scenes/:sid/verify', handler: verifyScene },
];
