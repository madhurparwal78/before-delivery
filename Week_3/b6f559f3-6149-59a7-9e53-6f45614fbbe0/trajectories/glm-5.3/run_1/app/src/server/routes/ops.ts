// Ops: applying changes with idempotency, locks, and the undo/redo engine.
import { sendJson } from '../http';
import {
  forbidden,
  conflict,
  validationMessage,
} from '../errors';
import { COPY } from '../../domain/copy';
import type { RouteCtx } from '../routes';
import { openProjectById, requirePersonRoute, newId } from '../store';
import type { SceneBundle, SceneDocument, Layer, Variable } from '../../domain/kinds';
import { applyChange, invertChange, type Change } from '../../domain/changes';
import { validateChange } from '../validate';
import { createHash } from 'node:crypto';

async function loadBundle(app: import('../app').App, projectId: string): Promise<SceneBundle> {
  const res = await app.pool.query<{ variables: unknown; presets: unknown }>(
    `SELECT variables, presets FROM scenes WHERE project_id = $1 ORDER BY ord LIMIT 1`,
    [projectId],
  );
  const scenes = await app.pool.query<{ doc: unknown }>(
    `SELECT doc FROM scenes WHERE project_id = $1 ORDER BY ord`,
    [projectId],
  );
  return {
    schemaVersion: 3,
    name: '',
    variables: (res.rows[0]?.variables as Variable[]) ?? [],
    presets: (res.rows[0]?.presets as SceneBundle['presets']) ?? [],
    scenes: scenes.rows.map((s) => s.doc as SceneDocument),
  };
}

async function saveBundle(
  app: import('../app').App,
  projectId: string,
  bundle: SceneBundle,
): Promise<void> {
  // Scenes are stored one row per scene; variables and presets on the first.
  for (const scene of bundle.scenes) {
    await app.pool.query(`UPDATE scenes SET doc = $3::jsonb WHERE project_id = $1 AND id = $2`, [
      projectId,
      scene.id,
      JSON.stringify(scene),
    ]);
  }
  const first = await app.pool.query<{ id: string }>(
    `SELECT id FROM scenes WHERE project_id = $1 ORDER BY ord LIMIT 1`,
    [projectId],
  );
  if (first.rows[0]) {
    await app.pool.query(
      `UPDATE scenes SET variables = $2::jsonb, presets = $3::jsonb WHERE project_id = $1 AND id = $4`,
      [projectId, JSON.stringify(bundle.variables), JSON.stringify(bundle.presets), first.rows[0].id],
    );
  }
}

function bodyHash(body: unknown): string {
  return createHash('sha256').update(JSON.stringify(body ?? null)).digest('hex');
}

// Idempotency: replaying an opId with the same body returns the stored
// response; a different body is a conflict.
async function idempotencyCheck(
  ctx: RouteCtx,
  scope: string,
  key: string,
  body: unknown,
): Promise<Record<string, unknown> | null> {
  const hash = bodyHash(body);
  const res = await ctx.app.pool.query<{
    body_hash: string;
    response: Record<string, unknown>;
  }>(
    `SELECT body_hash, response FROM idempotency WHERE scope = $1 AND key = $2`,
    [scope, key],
  );
  const row = res.rows[0];
  if (!row) return null;
  if (row.body_hash !== hash) {
    throw conflict('idempotency_conflict', COPY.idempotencyConflict);
  }
  return row.response;
}

async function storeIdempotency(
  ctx: RouteCtx,
  scope: string,
  key: string,
  body: unknown,
  response: Record<string, unknown>,
): Promise<void> {
  const hash = bodyHash(body);
  await ctx.app.pool.query(
    `INSERT INTO idempotency (key, scope, body_hash, response, created_at)
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (scope, key) DO NOTHING`,
    [key, scope, hash, JSON.stringify(response)],
  );
}

async function lockState(
  ctx: RouteCtx,
  projectId: string,
  layerId: string,
): Promise<{ holderId: string; holderName: string; expiresAt: Date } | null> {
  const res = await ctx.app.pool.query<{
    holder_id: string;
    holder_name: string;
    expires_at: Date;
  }>(
    `SELECT l.holder_id, p.name AS holder_name, l.expires_at
     FROM locks l JOIN people p ON p.id = l.holder_id
     WHERE l.project_id = $1 AND l.layer_id = $2`,
    [projectId, layerId],
  );
  const row = res.rows[0];
  if (!row) return null;
  if (row.expires_at.getTime() < ctx.app.clock.nowMs()) {
    await ctx.app.pool.query(
      `DELETE FROM locks WHERE project_id = $1 AND layer_id = $2`,
      [projectId, layerId],
    );
    return null;
  }
  return { holderId: row.holder_id, holderName: row.holder_name, expiresAt: row.expires_at };
}

export async function handleOps(ctx: RouteCtx, projectId: string): Promise<void> {
  const person = await requirePersonRoute(ctx);
  const { role } = await openProjectById(ctx.app, ctx, projectId, person);
  if (role === 'Viewer') throw forbidden(COPY.viewerEdit);
  const body = ctx.body as {
    opId?: string;
    sceneId?: string;
    changes?: Change[];
  };
  if (!body?.opId || typeof body.opId !== 'string' || body.opId.length < 1 || body.opId.length > 100) {
    throw validationMessage('Enter a name.', 'opId');
  }
  const scope = `ops:${projectId}:${person.id}`;
  const stored = await idempotencyCheck(ctx, scope, body.opId, body);
  if (stored) {
    sendJson(ctx.res, 200, stored);
    return;
  }
  // State: trashed projects refuse edits.
  const opened = await openProjectById(ctx.app, ctx, projectId, person);
  if (opened.project.status === 'trashed') throw conflict('trashed', COPY.trashed);

  const bundle = await loadBundle(ctx.app, projectId);
  const scene = bundle.scenes.find((s) => s.id === body.sceneId);
  if (!scene) throw validationMessage(COPY.notFound, 'sceneId');

  const changes = body.changes ?? [];
  const inverses: (Change | null)[] = [];

  // Validation of every change, then lock checks, then application.
  for (const ch of changes) {
    const err = validateChange(ch, bundle, scene, ctx.app.limits);
    if (err) throw err;
  }
  for (const ch of changes) {
    if (isLayerChange(ch)) {
      const lock = await lockState(ctx, projectId, ch.layerId);
      if (lock && lock.holderId !== person.id) {
        throw conflict('layer_held', COPY.layerHeld(lock.holderName));
      }
      const layer = scene.layers.find((l) => l.id === ch.layerId);
      if (layer?.locked) {
        throw conflict('layer_locked', COPY.layerLocked(layer.name));
      }
    }
  }

  const ids: Record<string, string> = {};
  for (const ch of changes) {
    inverses.push(invertChange(bundle, scene.id, ch));
    // New ids the server allocates
    if (ch.type === 'duplicateLayer' && !ch.newId) {
      (ch as { newId: string }).newId = newId('lay');
      ids['__dup__'] = (ch as { newId: string }).newId;
    }
    if (ch.type === 'group' && !ch.groupId) {
      (ch as { groupId: string }).groupId = newId('grp');
      ids['__group__'] = (ch as { groupId: string }).groupId;
    }
    if (ch.type === 'addLayer') {
      if (!ch.layer.id) {
        const id = newId('lay');
        (ch.layer as Layer).id = id;
      }
      ids[ch.ref] = ch.layer.id;
    }
    const res = applyChange(bundle, scene.id, ch);
    Object.assign(ids, res.ids);
  }

  // Record history and save.
  const historyRes = await ctx.app.pool.query<{ id: string }>(
    `INSERT INTO op_history (project_id, person_id, op_id, scene_id, changes, inverse, undone, created_at)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, FALSE, now()) RETURNING id::text AS id`,
    [projectId, person.id, body.opId, scene.id, JSON.stringify(changes), JSON.stringify(inverses)],
  );
  const seq = Number(historyRes.rows[0]!.id);
  await saveBundle(ctx.app, projectId, bundle);

  // A new step clears this person's redo list.
  await ctx.app.pool.query(
    `DELETE FROM redo_stack WHERE project_id = $1 AND person_id = $2`,
    [projectId, person.id],
  );
  // History is capped at UNDO_LIMIT steps; the oldest step is dropped.
  await ctx.app.pool.query(
    `DELETE FROM op_history WHERE project_id = $1 AND person_id = $2 AND undone = FALSE
     AND id NOT IN (
       SELECT id FROM op_history WHERE project_id = $1 AND person_id = $2 AND undone = FALSE
       ORDER BY id DESC LIMIT $3
     )`,
    [projectId, person.id, ctx.app.cfg.undoLimit],
  );

  const undoDepth = await depth(ctx, projectId, person.id, false);
  const response = { opId: body.opId, seq, undoDepth, redoDepth: 0, ids };
  await storeIdempotency(ctx, scope, body.opId, body, response);
  sendJson(ctx.res, 200, response);

  // Live: everyone sees the change within 2 s.
  ctx.hub.broadcastChanges(projectId, seq, changes, { id: person.id, name: person.name });
}

function isLayerChange(ch: Change): ch is Change & { layerId: string } {
  return 'layerId' in ch && ch.layerId !== undefined;
}

async function depth(
  ctx: RouteCtx,
  projectId: string,
  personId: string,
  undone: boolean,
): Promise<number> {
  const res = await ctx.app.pool.query<{ count: string }>(
    `SELECT count(*) FROM op_history
     WHERE project_id = $1 AND person_id = $2 AND undone = $3`,
    [projectId, personId, undone],
  );
  return Number(res.rows[0]!.count);
}

export async function handleUndo(ctx: RouteCtx, projectId: string): Promise<void> {
  return undoRedo(ctx, projectId, true);
}

export async function handleRedo(ctx: RouteCtx, projectId: string): Promise<void> {
  return undoRedo(ctx, projectId, false);
}

async function undoRedo(ctx: RouteCtx, projectId: string, undo: boolean): Promise<void> {
  const person = await requirePersonRoute(ctx);
  const { role } = await openProjectById(ctx.app, ctx, projectId, person);
  if (role === 'Viewer') throw forbidden(COPY.viewerEdit);
  const body = ctx.body as { opId?: string };
  if (!body?.opId) throw validationMessage('Enter a name.', 'opId');
  const opened = await openProjectById(ctx.app, ctx, projectId, person);
  if (opened.project.status === 'trashed') throw conflict('trashed', COPY.trashed);

  const scope = `undo:${projectId}:${person.id}:${undo ? 'u' : 'r'}`;
  const stored = await idempotencyCheck(ctx, scope, body.opId, body);
  if (stored) {
    sendJson(ctx.res, 200, stored);
    return;
  }

  const client = await ctx.app.pool.connect();
  try {
    await client.query('BEGIN');
    if (undo) {
      // The latest step of this person that is not yet undone.
      const res = await client.query<{
        id: string;
        scene_id: string;
        inverse: unknown;
      }>(
        `SELECT id, scene_id, inverse FROM op_history
         WHERE project_id = $1 AND person_id = $2 AND undone = FALSE
         ORDER BY id DESC LIMIT 1 FOR UPDATE`,
        [projectId, person.id],
      );
      const step = res.rows[0];
      if (!step) {
        await client.query('ROLLBACK');
        client.release();
        throw conflict('nothing_to_undo', COPY.nothingToUndo);
      }
      const bundle = await loadBundle(ctx.app, projectId);
      const scene = bundle.scenes.find((s) => s.id === step.scene_id);
      const inverse = step.inverse as Change[] | null;
      if (scene && inverse) {
        for (let i = inverse.length - 1; i >= 0; i--) {
          const inv = inverse[i];
          if (inv) applyChange(bundle, scene.id, inv);
        }
        await saveBundleWithClient(client, projectId, bundle);
      }
      await client.query(`UPDATE op_history SET undone = TRUE WHERE id = $1`, [step.id]);
      await client.query(
        `INSERT INTO redo_stack (project_id, person_id, seq, created_at)
         VALUES ($1, $2, $3, now())`,
        [projectId, person.id, step.id],
      );
      await client.query('COMMIT');
      const undoDepth = await depth(ctx, projectId, person.id, false);
      const redoDepth = await depth(ctx, projectId, person.id, true);
      const response = { opId: body.opId, seq: Number(step.id), undoDepth, redoDepth };
      await storeIdempotency(ctx, scope, body.opId, body, response);
      sendJson(ctx.res, 200, response);
      ctx.hub.broadcastChanges(projectId, Number(step.id), [], { id: person.id, name: person.name });
      client.release();
      return;
    }
    // Redo: the earliest undone step of this person with no earlier undone
    // steps after it (a strict stack).
    const res = await client.query<{ id: string; scene_id: string; changes: unknown }>(
      `SELECT id, scene_id, changes FROM op_history
       WHERE project_id = $1 AND person_id = $2 AND undone = TRUE
       ORDER BY id ASC LIMIT 1 FOR UPDATE`,
      [projectId, person.id],
    );
    const step = res.rows[0];
    if (!step) {
      await client.query('ROLLBACK');
      client.release();
      throw conflict('nothing_to_redo', COPY.nothingToRedo);
    }
    const bundle = await loadBundle(ctx.app, projectId);
    const scene = bundle.scenes.find((s) => s.id === step.scene_id);
    const changes = step.changes as Change[] | null;
    if (scene && changes) {
      for (const ch of changes) applyChange(bundle, scene.id, ch);
      await saveBundleWithClient(client, projectId, bundle);
    }
    await client.query(`UPDATE op_history SET undone = FALSE WHERE id = $1`, [step.id]);
    await client.query(`DELETE FROM redo_stack WHERE project_id = $1 AND person_id = $2`, [projectId, person.id]);
    await client.query('COMMIT');
    const undoDepth = await depth(ctx, projectId, person.id, false);
    const redoDepth = await depth(ctx, projectId, person.id, true);
    const response = { opId: body.opId, seq: Number(step.id), undoDepth, redoDepth };
    await storeIdempotency(ctx, scope, body.opId, body, response);
    sendJson(ctx.res, 200, response);
    ctx.hub.broadcastChanges(projectId, Number(step.id), [], { id: person.id, name: person.name });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    client.release();
    throw e;
  }
  client.release();
}

async function saveBundleWithClient(
  client: import('pg').PoolClient,
  projectId: string,
  bundle: SceneBundle,
): Promise<void> {
  for (const scene of bundle.scenes) {
    await client.query(`UPDATE scenes SET doc = $3::jsonb WHERE project_id = $1 AND id = $2`, [
      projectId,
      scene.id,
      JSON.stringify(scene),
    ]);
  }
  const first = await client.query<{ id: string }>(
    `SELECT id FROM scenes WHERE project_id = $1 ORDER BY ord LIMIT 1`,
    [projectId],
  );
  if (first.rows[0]) {
    await client.query(`UPDATE scenes SET variables = $2::jsonb, presets = $3::jsonb WHERE project_id = $1 AND id = $4`, [
      projectId,
      JSON.stringify(bundle.variables),
      JSON.stringify(bundle.presets),
      first.rows[0].id,
    ]);
  }
}

export async function handleLock(
  ctx: RouteCtx,
  projectId: string,
  layerId: string,
): Promise<void> {
  const person = await requirePersonRoute(ctx);
  const { role } = await openProjectById(ctx.app, ctx, projectId, person);
  if (role === 'Viewer') throw forbidden(COPY.viewerEdit);
  const opened = await openProjectById(ctx.app, ctx, projectId, person);
  if (opened.project.status === 'trashed') throw conflict('trashed', COPY.trashed);
  const existing = await lockState(ctx, projectId, layerId);
  if (existing && existing.holderId !== person.id) {
    throw conflict('layer_held', COPY.layerHeld(existing.holderName));
  }
  const expiresAt = new Date(ctx.app.clock.nowMs() + ctx.app.cfg.lockTimeoutSeconds * 1000);
  await ctx.app.pool.query(
    `INSERT INTO locks (project_id, layer_id, holder_id, expires_at)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (project_id, layer_id) DO UPDATE SET holder_id = $3, expires_at = $4`,
    [projectId, layerId, person.id, expiresAt],
  );
  sendJson(ctx.res, 200, {
    lock: {
      layerId,
      heldBy: { id: person.id, name: person.name },
      expiresAt: expiresAt.toISOString(),
    },
  });
  ctx.hub.broadcastLock(projectId, {
    layerId,
    heldBy: { id: person.id, name: person.name },
  });
}

export async function handleUnlock(ctx: RouteCtx, projectId: string, layerId: string): Promise<void> {
  const person = await requirePersonRoute(ctx);
  await openProjectById(ctx.app, ctx, projectId, person);
  const existing = await lockState(ctx, projectId, layerId);
  if (existing && existing.holderId !== person.id) {
    throw conflict('layer_held', COPY.layerHeld(existing.holderName));
  }
  await ctx.app.pool.query(
    `DELETE FROM locks WHERE project_id = $1 AND layer_id = $2 AND holder_id = $3`,
    [projectId, layerId, person.id],
  );
  ctx.res.writeHead(204);
  ctx.res.end();
  ctx.hub.broadcastLock(projectId, { layerId, heldBy: null });
}
