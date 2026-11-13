import type { Request } from 'express';
import { app } from './routes';
import { withClient, withTransaction } from './db';
import { AppError, asyncHandler, notFound } from './errors';
import { randomId, randomToken, sha256 } from './crypto';
import { writeActivity } from './activity';
import {
  PUBLIC_URL,
  SHARE_TTL,
  requireUser,
  requireRoleForProject,
  loadSceneWithAccess,
  jsonBody,
  rawBody,
  registerSceneChannel,
  notifyChannels,
  presenceBody,
  projectWorkspace,
  roleIn,
  workspaceName,
} from './shared';
import { validEmail } from './routes';
import { loadScene, loadDocument, documentBytes, computeStateHash, revisionFootprints, applyOps, fieldKeysForPatch, removedIdsForPatch } from './scenes';
import { checkRevisionConflict, type Op } from '../bench/ops';
import { KIND_SPECS, GRAVITY_SPEC, type SceneDocument, type SceneObject, type Vec3 } from '../bench/scene';
import { canonicalJson } from '../bench/canonical';
import { simulate, stateHashInput } from '../bench/sim';
import { COPY } from '../bench/copy';
import { takeLease, releaseLease, getLock, setPresence, dropPresence, LockHeld, redisAvailable, LOCK_TTL } from './locks';
import { storagePut, storageGet } from './storage';
import { queueMail, sendNow } from './mail';
import {
  detectKind,
  parseGlb,
  isSelfContained,
  measureExtentMetres,
  validUploadName,
  validUnit,
  EXTENT_MIN,
  EXTENT_MAX,
  UNITS_SCALE,
  type GlbJson,
} from '../bench/uploads';
import { assetSummary } from './routes';

// ---------- PATCH ----------

function isOp(value: unknown): value is Op {
  if (!value || typeof value !== 'object') return false;
  const op = value as Record<string, unknown>;
  if (op.op === 'scene') return op.field === 'name' || op.field === 'gravity';
  if (op.op === 'add') return typeof op.object === 'object' && op.object !== null;
  if (op.op === 'set') return typeof op.objectId === 'string' && typeof op.field === 'string';
  if (op.op === 'remove') return typeof op.objectId === 'string';
  return false;
}

app.patch('/api/scenes/:sid', asyncHandler(async (req, res) => {
  const user = await requireUser(req);
  const body = jsonBody(req);
  const baseRevision = Number(body.baseRevision ?? NaN);
  const changeId = String(body.changeId ?? '');
  const opsRaw = body.ops;
  if (!Number.isInteger(baseRevision) || baseRevision < 1 || typeof changeId !== 'string' || changeId.length < 8 || !Array.isArray(opsRaw) || !opsRaw.every(isOp)) {
    throw new AppError(422, 'validation', 'There is a problem');
  }
  const ops = opsRaw as Op[];
  const { scene, role } = await loadSceneWithAccess(req.params.sid!, user.id);
  if (role === 'viewer') throw new AppError(403, 'forbidden', 'You do not have permission to do that.');
  if (!(await redisAvailable())) throw new AppError(503, 'lock_store_unavailable', 'The lock service is unreachable.');

  const bodyHash = sha256(canonicalJson(ops));
  const result = await withTransaction(async (client) => {
    const replay = await client.query('SELECT * FROM scene_change_results WHERE scene_id = $1 AND change_id = $2', [scene.id, changeId]);
    if (replay.rows[0]) {
      const stored = replay.rows[0];
      if (stored.body_sha !== bodyHash) {
        throw new AppError(409, 'change_id_reused', 'This change id was used for a different change.');
      }
      return { replayed: true, response: stored.response as { revision: number; stateHash: string } };
    }
    const current = await loadScene(client, scene.id);
    if (!current) throw notFound();
    const docNow = await loadDocument(client, current.id, current.revision);

    // removed-object rule, judged before leases
    for (const op of ops) {
      if ((op.op === 'set' || op.op === 'remove') && !docNow.objects.some((o) => o.id === op.objectId)) {
        const removedBy = await wasRemovedAfter(client, current.id, op.objectId, baseRevision);
        if (removedBy) {
          throw new AppError(412, 'revision_conflict', COPY.saveStatus.revisionConflict, undefined, {
            currentRevision: current.revision,
            conflicts: objectKeysFor(op.objectId),
          });
        }
        throw notFound();
      }
    }

    // lease fencing for set/remove
    for (const op of ops) {
      if (op.op === 'set' || op.op === 'remove') {
        const lock = await getLock(current.id, op.objectId);
        if (!lock || lock.userId !== user.id || lock.fence !== op.fence) {
          throw new AppError(409, 'stale_lock', 'Your hold on this object ran out.', undefined, { objectId: op.objectId });
        }
      }
    }

    // value validation
    const fields = validateOps(docNow, ops);
    if (fields && Object.keys(fields).length > 0) {
      throw new AppError(422, 'validation', 'There is a problem', fields);
    }

    // conflict and restore barrier
    if (baseRevision !== current.revision) {
      const myKeys = fieldKeysForPatch(ops);
      const myRemoved = removedIdsForPatch(ops);
      const footprints = baseRevision < current.revision
        ? await revisionFootprints(client, current.id, baseRevision, current.revision)
        : [];
      const outcome = checkRevisionConflict(baseRevision, current.revision, myKeys, myRemoved, footprints, current.latest_restore_revision);
      if (outcome.conflict) {
        throw new AppError(412, 'revision_conflict', COPY.saveStatus.revisionConflict, undefined, {
          currentRevision: current.revision,
          conflicts: outcome.conflicts,
        });
      }
    }

    const nextDoc = applyOps(docNow, ops);
    const nextRevision = current.revision + 1;
    const hash = computeStateHash(nextDoc, 0);
    await client.query(
      'INSERT INTO scene_revisions (scene_id, revision, document, ops, change_id) VALUES ($1,$2,$3,$4,$5)',
      [current.id, nextRevision, documentBytes(nextDoc), JSON.stringify(ops), changeId],
    );
    await client.query('UPDATE scenes SET revision = $1, updated_at = now() WHERE id = $2', [nextRevision, current.id]);
    const ws = await projectWorkspace(client, current.project_id);
    await writeActivity(client, ws!, user, 'scene.edited', current.name);
    const response = { revision: nextRevision, stateHash: hash };
    await client.query(
      'INSERT INTO scene_change_results (scene_id, change_id, response, body_sha) VALUES ($1,$2,$3,$4)',
      [current.id, changeId, JSON.stringify(response), bodyHash],
    );
    return { replayed: false, response };
  });

  if (!result.replayed) {
    notifyChannels(req.params.sid!, { type: 'revision', revision: result.response.revision, stateHash: result.response.stateHash });
  }
  res.json(result.response);
}));

async function wasRemovedAfter(client: Parameters<typeof loadScene>[0], sceneId: string, objectId: string, afterRevision: number): Promise<boolean> {
  const rows = await client.query(
    "SELECT revision, ops FROM scene_revisions WHERE scene_id = $1 AND revision > $2",
    [sceneId, afterRevision],
  );
  for (const row of rows.rows as Array<{ ops: Op[] }>) {
    for (const op of row.ops) {
      if (op.op === 'remove' && op.objectId === objectId) return true;
    }
  }
  return false;
}

function objectKeysFor(objectId: string): string[] {
  return [`${objectId}.name`, `${objectId}.position`, `${objectId}.rotation`, `${objectId}.scale`, `${objectId}.params`];
}

function validateOps(doc: SceneDocument, ops: Op[]): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const op of ops) {
    if (op.op === 'scene') {
      if (op.field === 'name') {
        const value = String(op.value);
        if (value.length < 1 || value.length > 60) fields['scene.name'] = COPY.fieldErrors.name;
      } else {
        const value = Number(op.value);
        if (!(value >= GRAVITY_SPEC.min && value <= GRAVITY_SPEC.max)) {
          fields['scene.gravity'] = COPY.fieldErrors.range(GRAVITY_SPEC.min, GRAVITY_SPEC.max);
        }
      }
    } else if (op.op === 'add') {
      const object = op.object as unknown as SceneObject;
      const err = validateObject(object);
      if (err) fields[`${object.id}.${err.field}`] = err.message;
    } else if (op.op === 'set') {
      const object = doc.objects.find((o) => o.id === op.objectId);
      if (!object) continue;
      if (op.field === 'name') {
        const value = String(op.value);
        if (value.length < 1 || value.length > 60) fields[`${object.id}.name`] = COPY.fieldErrors.name;
      } else if (op.field === 'position') {
        const value = op.value as number[];
        if (!Array.isArray(value) || value.length !== 3 || !value.every((n) => Math.abs(n) <= 500)) {
          fields[`${object.id}.position`] = COPY.fieldErrors.transform;
        }
      } else if (op.field === 'scale') {
        const value = op.value as number[];
        if (!Array.isArray(value) || value.length !== 3 || !value.every((n) => n >= 0.01 && n <= 100)) {
          fields[`${object.id}.scale`] = COPY.fieldErrors.transform;
        }
      } else if (op.field === 'rotation') {
        const value = op.value as number[];
        if (!Array.isArray(value) || value.length !== 4) fields[`${object.id}.rotation`] = COPY.fieldErrors.transform;
      } else if (op.field.startsWith('params.')) {
        const param = op.field.slice('params.'.length);
        const spec = KIND_SPECS[object.kind].params.find((p) => p.key === param);
        if (spec) {
          const value = Number(op.value);
          if (!(value >= spec.min && value <= spec.max)) {
            fields[`${object.id}.params.${param}`] = COPY.fieldErrors.range(spec.min, spec.max);
          }
        }
      }
    }
  }
  return fields;
}

function validateObject(object: SceneObject): { field: string; message: string } | null {
  if (object.name.length < 1 || object.name.length > 60) return { field: 'name', message: COPY.fieldErrors.name };
  if (!object.position.every((n) => Math.abs(n) <= 500)) return { field: 'position', message: COPY.fieldErrors.transform };
  if (!object.scale.every((n) => n >= 0.01 && n <= 100)) return { field: 'scale', message: COPY.fieldErrors.transform };
  for (const spec of KIND_SPECS[object.kind].params) {
    const value = object.params[spec.key];
    if (value === undefined || !(value >= spec.min && value <= spec.max)) {
      return { field: `params.${spec.key}`, message: COPY.fieldErrors.range(spec.min, spec.max) };
    }
  }
  return null;
}

// ---------- verify ----------

app.post('/api/scenes/:sid/verify', asyncHandler(async (req, res) => {
  const user = await requireUser(req);
  const { scene } = await loadSceneWithAccess(req.params.sid!, user.id);
  const body = jsonBody(req);
  const steps = Number(body.steps ?? NaN);
  if (!Number.isInteger(steps) || steps < 1 || steps > 12000) {
    throw new AppError(422, 'validation', COPY.fieldErrors.steps, { steps: COPY.fieldErrors.steps });
  }
  const params = (body.params ?? {}) as Record<string, number>;
  const doc = await withClient(async (client) => loadDocument(client, scene.id, scene.revision));
  const state = simulate(doc, steps, params);
  res.json({ step: steps, stateHash: sha256(stateHashInput(state)) });
}));

// ---------- locks ----------

app.post('/api/scenes/:sid/locks/:objectId', asyncHandler(async (req, res) => {
  const user = await requireUser(req);
  const { scene, role } = await loadSceneWithAccess(req.params.sid!, user.id);
  if (role === 'viewer') throw new AppError(403, 'forbidden', 'You do not have permission to do that.');
  if (!(await redisAvailable())) throw new AppError(503, 'lock_store_unavailable', 'The lock service is unreachable.');
  const tab = String((jsonBody(req).tab as string | undefined) ?? 'default');
  const exists = await withClient(async (client) => {
    const doc = await loadDocument(client, scene.id, scene.revision);
    return doc.objects.some((o) => o.id === req.params.objectId);
  });
  if (!exists) throw notFound();
  try {
    const lock = await takeLease(scene.id, req.params.objectId!, { userId: user.id, displayName: user.displayName, tab });
    res.json({
      lock: {
        objectId: req.params.objectId,
        holder: { userId: user.id, displayName: user.displayName },
        fence: lock.fence,
        expiresAt: new Date(Date.now() + LOCK_TTL * 1000).toISOString(),
      },
    });
  } catch (e) {
    if (e instanceof LockHeld) {
      throw new AppError(409, 'lock_held', 'Another editor holds this object.', undefined, {
        holder: { userId: e.holder.userId, displayName: e.holder.displayName },
        expiresAt: new Date(Date.now() + LOCK_TTL * 1000).toISOString(),
      });
    }
    throw e;
  }
}));

app.delete('/api/scenes/:sid/locks/:objectId', asyncHandler(async (req, res) => {
  const user = await requireUser(req);
  const { scene } = await loadSceneWithAccess(req.params.sid!, user.id);
  const tab = String(req.query.tab ?? 'default');
  const lock = await getLock(scene.id, req.params.objectId!);
  if (lock && lock.userId !== user.id) {
    throw new AppError(409, 'lock_held', 'Another editor holds this object.');
  }
  await releaseLease(scene.id, req.params.objectId!, user.id, tab);
  res.status(204).end();
}));

// ---------- presence ----------

app.put('/api/scenes/:sid/presence', asyncHandler(async (req, res) => {
  const user = await requireUser(req);
  const { scene } = await loadSceneWithAccess(req.params.sid!, user.id);
  const body = jsonBody(req);
  const tab = String(body.tab ?? '');
  if (!/^[A-Za-z0-9-]{1,64}$/.test(tab)) throw new AppError(422, 'validation', 'There is a problem');
  const cursor = Array.isArray(body.cursor) && body.cursor.length === 3 && body.cursor.every((n) => typeof n === 'number')
    ? (body.cursor as Vec3)
    : null;
  await setPresence(scene.id, user.id, tab, {
    displayName: user.displayName,
    cursor,
    selected: typeof body.selected === 'string' ? body.selected : null,
  });
  res.status(204).end();
}));

app.delete('/api/scenes/:sid/presence', asyncHandler(async (req, res) => {
  const user = await requireUser(req);
  const { scene } = await loadSceneWithAccess(req.params.sid!, user.id);
  await dropPresence(scene.id, user.id, String(req.query.tab ?? ''));
  res.status(204).end();
}));

app.get('/api/scenes/:sid/presence', asyncHandler(async (req, res) => {
  const user = await requireUser(req);
  const { scene } = await loadSceneWithAccess(req.params.sid!, user.id);
  res.json(await presenceBody(scene.id));
}));

// ---------- live channel ----------

app.get('/api/scenes/:sid/live', asyncHandler(async (req, res) => {
  const user = await requireUser(req);
  const { scene, workspaceId, role } = await loadSceneWithAccess(req.params.sid!, user.id);
  const tab = String(req.query.tab ?? '');
  if (!/^[A-Za-z0-9-]{8,64}$/.test(tab)) throw new AppError(422, 'validation', 'There is a problem');
  await registerSceneChannel(res, scene.id, user.id, tab, role, workspaceId);
}));

// ---------- assets ----------

app.post('/api/projects/:pid/assets', asyncHandler(async (req, res) => {
  const user = await requireUser(req);
  await requireRoleForProject(req.params.pid!, user.id, ['owner', 'editor']);
  const name = String(req.query.name ?? '');
  const unit = String(req.query.unit ?? 'm');
  const body = rawBody(req);
  const fields: Record<string, string> = {};
  if (!validUploadName(name)) fields.name = COPY.fieldErrors.uploadName;
  if (!validUnit(unit)) fields.unit = COPY.fieldErrors.uploadUnit;
  if (Object.keys(fields).length > 0) throw new AppError(422, 'validation', 'There is a problem', fields);
  const kind = detectKind(body);
  if (!kind) throw new AppError(422, 'validation', 'There is a problem', { file: COPY.fieldErrors.uploadType });
  const hash = sha256(body);
  let json: GlbJson | null = null;
  let extent: number | null = null;
  if (kind === 'glb' || kind === 'gltf') {
    json = kind === 'glb' ? parseGlb(body) : (JSON.parse(body.toString('utf8')) as GlbJson);
    if (!json || typeof json !== 'object' || json.asset?.version !== '2.0') {
      throw new AppError(422, 'validation', 'There is a problem', { file: COPY.fieldErrors.uploadDamaged });
    }
    if (!isSelfContained(json)) {
      throw new AppError(422, 'validation', 'There is a problem', { file: COPY.fieldErrors.uploadExternal });
    }
    extent = measureExtentMetres(json, unit);
    if (extent === null) {
      throw new AppError(422, 'validation', 'There is a problem', { file: COPY.fieldErrors.uploadDamaged });
    }
    if (extent < EXTENT_MIN || extent > EXTENT_MAX) {
      throw new AppError(422, 'validation', 'There is a problem', { file: COPY.fieldErrors.uploadExtent });
    }
  }
  const stored = await withTransaction(async (client) => {
    const existing = await client.query('SELECT * FROM assets WHERE project_id = $1 AND sha256 = $2', [req.params.pid!, hash]);
    if (existing.rows[0]) return { existing: existing.rows[0], asset: null };
    await storagePut(`assets/${req.params.pid}/${hash}`, body, kind === 'glb' ? 'model/gltf-binary' : kind === 'gltf' ? 'model/gltf+json' : kind === 'png' ? 'image/png' : 'image/jpeg');
    const id = randomId('ast');
    await client.query(
      'INSERT INTO assets (id, project_id, name, kind, bytes, sha256, unit, scale_to_metres, extent_metres) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      kind === 'png' || kind === 'jpeg'
        ? [id, req.params.pid!, name, kind, body.length, hash, null, null, null]
        : [id, req.params.pid!, name, kind, body.length, hash, unit, UNITS_SCALE[unit], extent],
    );
    const ws = await projectWorkspace(client, req.params.pid!);
    await writeActivity(client, ws!, user, 'asset.uploaded', name);
    const row = await client.query('SELECT * FROM assets WHERE id = $1', [id]);
    return { existing: null, asset: row.rows[0] };
  });
  const asset = (stored.existing ?? stored.asset)!;
  res.status(stored.existing ? 200 : 201).json({ asset: assetSummary(asset) });
}));

app.get('/api/assets/:aid/original', asyncHandler(async (req, res) => {
  const user = await requireUser(req);
  const asset = await withClient(async (client) => {
    const row = await client.query('SELECT * FROM assets WHERE id = $1', [req.params.aid!]);
    return row.rows[0];
  });
  if (!asset) throw notFound();
  const workspaceId = await withClient(async (client) => projectWorkspace(client, asset.project_id));
  if (!workspaceId) throw notFound();
  const role = await withClient(async (client) => roleIn(client, workspaceId, user.id));
  if (!role) throw notFound();
  const bytes = await storageGet(`assets/${asset.project_id}/${asset.sha256}`);
  res.setHeader('Content-Type', asset.kind === 'glb' ? 'model/gltf-binary' : asset.kind === 'gltf' ? 'model/gltf+json' : asset.kind === 'png' ? 'image/png' : 'image/jpeg');
  res.setHeader('ETag', `"${asset.sha256}"`);
  res.send(bytes);
}));

// ---------- checkpoints ----------

app.post('/api/scenes/:sid/checkpoints', asyncHandler(async (req, res) => {
  const user = await requireUser(req);
  const { scene, role } = await loadSceneWithAccess(req.params.sid!, user.id);
  if (role === 'viewer') throw new AppError(403, 'forbidden', 'You do not have permission to do that.');
  const body = jsonBody(req);
  const label = String(body.label ?? '').trim();
  if (label.length < 1 || label.length > 60) {
    throw new AppError(422, 'validation', 'There is a problem', { label: COPY.fieldErrors.checkpointLabel });
  }
  const labelFolded = label.toLowerCase();
  const result = await withTransaction(async (client) => {
    const dupe = await client.query('SELECT 1 FROM checkpoints WHERE scene_id = $1 AND label_folded = $2', [scene.id, labelFolded]);
    if (dupe.rows[0]) {
      throw new AppError(409, 'checkpoint_name_taken', COPY.fieldErrors.checkpointTaken, { label: COPY.fieldErrors.checkpointTaken });
    }
    const current = await loadScene(client, scene.id);
    if (!current) throw notFound();
    const doc = await loadDocument(client, current.id, current.revision);
    const bytes = documentBytes(doc);
    const docHash = sha256(bytes);
    const stateHashValue = computeStateHash(doc, 0);
    const id = randomId('chk');
    await storagePut(`checkpoints/${scene.id}/${id}.json`, Buffer.from(bytes, 'utf8'), 'application/json');
    await client.query(
      'INSERT INTO checkpoints (id, scene_id, label, label_folded, revision, state_hash, document_sha256) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [id, scene.id, label, labelFolded, current.revision, stateHashValue, docHash],
    );
    if (current.status === 'draft') {
      await client.query("UPDATE scenes SET status = 'checkpointed' WHERE id = $1", [scene.id]);
    }
    const ws = await projectWorkspace(client, current.project_id);
    await writeActivity(client, ws!, user, 'checkpoint.created', label);
    return { id, revision: current.revision, stateHash: stateHashValue, documentSha256: docHash };
  });
  res.status(201).json({
    checkpoint: {
      id: result.id,
      label,
      revision: result.revision,
      stateHash: result.stateHash,
      documentSha256: result.documentSha256,
      createdAt: new Date().toISOString(),
    },
  });
}));

app.get('/api/scenes/:sid/checkpoints', asyncHandler(async (req, res) => {
  const user = await requireUser(req);
  const { scene } = await loadSceneWithAccess(req.params.sid!, user.id);
  const rows = await withClient(async (client) => {
    const result = await client.query('SELECT * FROM checkpoints WHERE scene_id = $1 ORDER BY created_at DESC, id DESC', [scene.id]);
    return result.rows;
  });
  res.json({
    checkpoints: rows.map((row: { id: string; label: string; revision: number; state_hash: string; document_sha256: string; created_at: Date }) => ({
      id: row.id,
      label: row.label,
      revision: row.revision,
      stateHash: row.state_hash,
      documentSha256: row.document_sha256,
      createdAt: new Date(row.created_at).toISOString(),
    })),
  });
}));

app.get('/api/scenes/:sid/checkpoints/:cid/document', asyncHandler(async (req, res) => {
  const user = await requireUser(req);
  const { scene } = await loadSceneWithAccess(req.params.sid!, user.id);
  const bytes = await storageGet(`checkpoints/${scene.id}/${req.params.cid!}.json`);
  res.setHeader('Content-Type', 'application/json');
  res.send(bytes);
}));

app.post('/api/scenes/:sid/checkpoints/:cid/restore', asyncHandler(async (req, res) => {
  const user = await requireUser(req);
  const { scene, role, workspaceId } = await loadSceneWithAccess(req.params.sid!, user.id);
  if (role === 'viewer') throw new AppError(403, 'forbidden', 'You do not have permission to do that.');
  const result = await withTransaction(async (client) => {
    const checkpoint = await client.query('SELECT * FROM checkpoints WHERE id = $1 AND scene_id = $2', [req.params.cid!, scene.id]);
    if (!checkpoint.rows[0]) throw notFound();
    const current = await loadScene(client, scene.id);
    if (!current) throw notFound();
    const presence = await presenceBody(current.id);
    const others = presence.locks.filter((l) => l.holder.userId !== user.id);
    if (others.length > 0) {
      throw new AppError(409, 'locks_held', COPY.saveStatus.restoreRefused, undefined, { holders: others.map((l) => l.holder) });
    }
    const bytes = await storageGet(`checkpoints/${scene.id}/${req.params.cid!}.json`);
    const nextRevision = current.revision + 1;
    await client.query(
      'INSERT INTO scene_revisions (scene_id, revision, document, ops, change_id) VALUES ($1,$2,$3,$4,$5)',
      [scene.id, nextRevision, bytes.toString('utf8'), JSON.stringify([]), null],
    );
    await client.query('UPDATE scenes SET revision = $1, latest_restore_revision = $1, updated_at = now() WHERE id = $2', [nextRevision, scene.id]);
    await writeActivity(client, workspaceId, user, 'checkpoint.restored', checkpoint.rows[0].label);
    const doc = JSON.parse(bytes.toString('utf8')) as SceneDocument;
    return { revision: nextRevision, stateHash: computeStateHash(doc, 0) };
  });
  notifyChannels(req.params.sid!, { type: 'revision', revision: result.revision, stateHash: result.stateHash });
  res.json({ revision: result.revision, stateHash: result.stateHash });
}));

// ---------- publishing ----------

app.post('/api/scenes/:sid/publish', asyncHandler(async (req, res) => {
  const user = await requireUser(req);
  const { scene, role, workspaceId } = await loadSceneWithAccess(req.params.sid!, user.id);
  if (role !== 'owner') throw new AppError(403, 'forbidden', 'You do not have permission to do that.');
  const body = jsonBody(req);
  const checkpointId = String(body.checkpointId ?? '');
  const exposed = body.exposed;
  if (!Array.isArray(exposed) || exposed.length > 8 || !exposed.every((k) => typeof k === 'string')) {
    throw new AppError(422, 'validation', 'There is a problem', { exposed: COPY.fieldErrors.exposed });
  }
  const result = await withTransaction(async (client) => {
    const current = await loadScene(client, scene.id);
    if (!current) throw notFound();
    if (current.status === 'draft') throw new AppError(409, 'no_checkpoint', COPY.notices.publishNoCheckpoint);
    const checkpoint = await client.query('SELECT * FROM checkpoints WHERE id = $1 AND scene_id = $2', [checkpointId, scene.id]);
    if (!checkpoint.rows[0]) throw new AppError(422, 'validation', 'There is a problem', { exposed: COPY.fieldErrors.exposed });
    const doc = await loadDocument(client, scene.id, checkpoint.rows[0].revision);
    for (const key of exposed as string[]) {
      const [objectId, param] = String(key).split('.');
      const object = doc.objects.find((o) => o.id === objectId);
      if (!object || KIND_SPECS[object.kind].params.every((p) => p.key !== param)) {
        throw new AppError(422, 'validation', 'There is a problem', { exposed: COPY.fieldErrors.exposed });
      }
    }
    const modelIds = doc.objects.filter((o) => o.kind === 'model' && o.assetId).map((o) => o.assetId!);
    const assetRows = modelIds.length > 0
      ? await client.query('SELECT * FROM assets WHERE id = ANY($1)', [modelIds])
      : { rows: [] as Array<{ id: string; kind: string; scale_to_metres: number | null; sha256: string }> };
    const assets = assetRows.rows
      .map((a) => ({ assetId: a.id, kind: a.kind, scaleToMetres: a.scale_to_metres, sha256: a.sha256 }))
      .sort((a: { sha256: string }, b: { sha256: string }) => (a.sha256 < b.sha256 ? -1 : 1));
    const bundle = {
      assets,
      bundleVersion: 1,
      checkpointId: checkpoint.rows[0].id,
      document: doc,
      exposed,
      solver: { iterations: 4, step: '1/120' },
    };
    const bundleBytes = canonicalJson(bundle);
    const bundleHash = sha256(bundleBytes);
    await storagePut(`labs/${scene.id}/${bundleHash}.json`, Buffer.from(bundleBytes, 'utf8'), 'application/json');
    const existingLab = await client.query("SELECT * FROM labs WHERE scene_id = $1 AND status = 'active'", [scene.id]);
    let token = existingLab.rows[0]?.token as string | undefined;
    if (!token) {
      token = randomToken(24);
      await client.query(
        "INSERT INTO labs (scene_id, token, bundle_hash, checkpoint_id, exposed, status) VALUES ($1,$2,$3,$4,$5,'active')",
        [scene.id, token, bundleHash, checkpoint.rows[0].id, JSON.stringify(exposed)],
      );
    } else {
      await client.query(
        "UPDATE labs SET bundle_hash = $1, published_at = now(), checkpoint_id = $2, exposed = $3 WHERE scene_id = $4 AND token = $5",
        [bundleHash, checkpoint.rows[0].id, JSON.stringify(exposed), scene.id, token],
      );
    }
    await client.query("UPDATE scenes SET status = 'published' WHERE id = $1", [scene.id]);
    await writeActivity(client, workspaceId, user, 'scene.published', current.name);
    await queueMail(client, {
      to: user.email,
      subject: `Lab published: ${current.name}`,
      body: `Your lab is published at ${PUBLIC_URL}/lab/${token}\nBundle hash: ${bundleHash}`,
      kind: 'publish',
      refId: token,
    });
    return { token, bundleHash, checkpointId: checkpoint.rows[0].id, exposed };
  });
  const sent = await withClient(async (client) => {
    const row = await client.query('SELECT id FROM mail_outbox WHERE kind = $1 AND ref_id = $2 AND sent_at IS NULL', ['publish', result.token]);
    if (!row.rows[0]) return true;
    return await sendNow(client, row.rows[0].id);
  });
  res.status(201).json({
    lab: {
      token: result.token,
      url: `${PUBLIC_URL}/lab/${result.token}`,
      bundleHash: result.bundleHash,
      publishedAt: new Date().toISOString(),
      checkpointId: result.checkpointId,
      exposed: result.exposed,
    },
    delivery: sent ? 'sent' : 'queued',
  });
}));

app.post('/api/scenes/:sid/unpublish', asyncHandler(async (req, res) => {
  const user = await requireUser(req);
  const { scene, role, workspaceId } = await loadSceneWithAccess(req.params.sid!, user.id);
  if (role !== 'owner') throw new AppError(403, 'forbidden', 'You do not have permission to do that.');
  const name = await withTransaction(async (client) => {
    const current = await loadScene(client, scene.id);
    if (!current) throw notFound();
    const lab = await client.query("SELECT * FROM labs WHERE scene_id = $1 AND status = 'active'", [scene.id]);
    if (!lab.rows[0]) throw new AppError(409, 'not_published', 'This scene is not published.');
    await client.query("UPDATE labs SET status = 'dead' WHERE scene_id = $1 AND status = 'active'", [scene.id]);
    await client.query("UPDATE scenes SET status = 'unpublished' WHERE id = $1", [scene.id]);
    await writeActivity(client, workspaceId, user, 'scene.unpublished', current.name);
    return current.name;
  });
  const doc = await withClient(async (client) => loadDocument(client, scene.id, scene.revision));
  res.json({ scene: { id: scene.id, name, status: 'unpublished', revision: scene.revision, stateHash: computeStateHash(doc, 0) } });
}));

app.post('/api/scenes/:sid/lab-link/regenerate', asyncHandler(async (req, res) => {
  const user = await requireUser(req);
  const { scene, role, workspaceId } = await loadSceneWithAccess(req.params.sid!, user.id);
  if (role !== 'owner') throw new AppError(403, 'forbidden', 'You do not have permission to do that.');
  const result = await withTransaction(async (client) => {
    const current = await loadScene(client, scene.id);
    if (!current) throw notFound();
    const lab = await client.query("SELECT * FROM labs WHERE scene_id = $1 AND status = 'active'", [scene.id]);
    if (!lab.rows[0]) throw new AppError(409, 'not_published', 'This scene is not published.');
    const token = randomToken(24);
    await client.query("UPDATE labs SET status = 'dead' WHERE scene_id = $1 AND status = 'active'", [scene.id]);
    await client.query(
      "INSERT INTO labs (scene_id, token, bundle_hash, published_at, checkpoint_id, exposed, status) VALUES ($1,$2,$3,now(),$4,$5,'active')",
      [scene.id, token, lab.rows[0].bundle_hash, lab.rows[0].checkpoint_id, lab.rows[0].exposed],
    );
    await writeActivity(client, workspaceId, user, 'lab_link.regenerated', current.name);
    return { token, bundleHash: lab.rows[0].bundle_hash, checkpointId: lab.rows[0].checkpoint_id, exposed: lab.rows[0].exposed };
  });
  res.json({
    lab: {
      token: result.token,
      url: `${PUBLIC_URL}/lab/${result.token}`,
      bundleHash: result.bundleHash,
      publishedAt: new Date().toISOString(),
      checkpointId: result.checkpointId,
      exposed: result.exposed,
    },
  });
}));

// ---------- share links ----------

app.post('/api/projects/:pid/share-links', asyncHandler(async (req, res) => {
  const user = await requireUser(req);
  const workspaceId = await requireRoleForProject(req.params.pid!, user.id, ['owner']);
  const body = jsonBody(req);
  const email = body.email !== undefined ? String(body.email).trim() : null;
  if (email !== null && !validEmail(email)) {
    throw new AppError(422, 'validation', 'There is a problem', { email: COPY.fieldErrors.email });
  }
  const result = await withTransaction(async (client) => {
    const id = randomId('lnk');
    const token = randomToken(24);
    const expiresAt = new Date(Date.now() + SHARE_TTL * 1000);
    await client.query("INSERT INTO share_links (id, project_id, token, status, expires_at) VALUES ($1,$2,$3,'active',$4)", [id, req.params.pid!, token, expiresAt]);
    const project = await client.query('SELECT name FROM projects WHERE id = $1', [req.params.pid!]);
    await writeActivity(client, workspaceId, user, 'share_link.created', project.rows[0].name);
    if (email) {
      await queueMail(client, {
        to: email,
        subject: `${user.displayName} shared ${project.rows[0].name} with you`,
        body: `${PUBLIC_URL}/view/${token}\nThis link expires ${expiresAt.toISOString()}.`,
        kind: 'share',
        refId: id,
      });
    }
    return { id, token, expiresAt };
  });
  let delivery: string | null = null;
  if (email) {
    const sent = await withClient(async (client) => {
      const row = await client.query('SELECT id FROM mail_outbox WHERE kind = $1 AND ref_id = $2 AND sent_at IS NULL', ['share', result.id]);
      if (!row.rows[0]) return true;
      return await sendNow(client, row.rows[0].id);
    });
    delivery = sent ? 'sent' : 'queued';
  }
  res.status(201).json({
    link: { id: result.id, token: result.token, url: `${PUBLIC_URL}/view/${result.token}`, expiresAt: result.expiresAt.toISOString() },
    delivery,
  });
}));

app.get('/api/projects/:pid/share-links', asyncHandler(async (req, res) => {
  await requireRoleForProject(req.params.pid!, (await requireUser(req)).id, ['owner']);
  const rows = await withClient(async (client) => {
    const result = await client.query("SELECT * FROM share_links WHERE project_id = $1 AND status = 'active' AND expires_at > now() ORDER BY created_at ASC", [req.params.pid!]);
    return result.rows;
  });
  res.json({
    links: rows.map((row: { id: string; token: string; expires_at: Date }) => ({
      id: row.id,
      token: row.token,
      url: `${PUBLIC_URL}/view/${row.token}`,
      expiresAt: new Date(row.expires_at).toISOString(),
    })),
  });
}));

app.post('/api/share-links/:id/regenerate', asyncHandler(async (req, res) => {
  const user = await requireUser(req);
  const result = await withTransaction(async (client) => {
    const row = await client.query('SELECT * FROM share_links WHERE id = $1', [req.params.id!]);
    const link = row.rows[0];
    if (!link) throw notFound();
    const ws = await projectWorkspace(client, link.project_id);
    if (!ws) throw notFound();
    const role = await roleIn(client, ws, user.id);
    if (role !== 'owner') throw new AppError(403, 'forbidden', 'You do not have permission to do that.');
    const token = randomToken(24);
    const expiresAt = new Date(Date.now() + SHARE_TTL * 1000);
    await client.query("UPDATE share_links SET status = 'revoked' WHERE id = $1", [link.id]);
    const newId = randomId('lnk');
    await client.query("INSERT INTO share_links (id, project_id, token, status, expires_at) VALUES ($1,$2,$3,'active',$4)", [newId, link.project_id, token, expiresAt]);
    const project = await client.query('SELECT name FROM projects WHERE id = $1', [link.project_id]);
    await writeActivity(client, ws, user, 'share_link.regenerated', project.rows[0].name);
    return { id: newId, token, expiresAt };
  });
  res.status(201).json({ link: { id: result.id, token: result.token, url: `${PUBLIC_URL}/view/${result.token}`, expiresAt: result.expiresAt.toISOString() } });
}));

app.delete('/api/share-links/:id', asyncHandler(async (req, res) => {
  const user = await requireUser(req);
  await withTransaction(async (client) => {
    const row = await client.query('SELECT * FROM share_links WHERE id = $1', [req.params.id!]);
    const link = row.rows[0];
    if (!link) throw notFound();
    const ws = await projectWorkspace(client, link.project_id);
    if (!ws) throw notFound();
    const role = await roleIn(client, ws, user.id);
    if (role !== 'owner') throw new AppError(403, 'forbidden', 'You do not have permission to do that.');
    await client.query("UPDATE share_links SET status = 'revoked' WHERE id = $1", [link.id]);
    const project = await client.query('SELECT name FROM projects WHERE id = $1', [link.project_id]);
    await writeActivity(client, ws, user, 'share_link.revoked', project.rows[0].name);
  });
  res.status(204).end();
}));
