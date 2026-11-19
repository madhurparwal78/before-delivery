import { bodyLimits, config } from '../config.js';
import { newId, pool } from '../db.js';
import { apiErrors } from '../errors.js';
import type { Handler, Router } from '../http.js';
import {
  StorageDown,
  fileKey,
  getObject,
  putObject,
  sha256Hex,
  snapshotInputKey,
  snapshotOutputKey,
} from '../storage.js';
import { createSnapshot, findSnapshot, snapshotBody, snapshotStatus } from '../snapshots.js';
import { validateSteps, type FieldErrors } from '../../shared/recipe.js';
import { visibleRecipe } from '../store.js';

function decodeBase64Field(value: unknown, field: string, fields: FieldErrors): Uint8Array {
  if (typeof value !== 'string') {
    fields[field] = 'Send base64 bytes.';
    return new Uint8Array();
  }
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value)) {
    fields[field] = 'Send base64 bytes.';
    return new Uint8Array();
  }
  return new Uint8Array(Buffer.from(value, 'base64'));
}

export function registerAssetRoutes(router: Router): void {
  router.add('POST', '/api/files', async (ctx) => {
    const session = ctx.requireSession();
    const limit = config.limits.fileMaxBytes;
    const declared = Number(ctx.request.headers['content-length'] ?? '0');
    if (declared > limit) throw apiErrors.fileTooLarge(declared, limit);
    const name = ctx.request.headers['x-file-name'];
    const bytes = await ctx.readBytes(limit, (size) => apiErrors.fileTooLarge(size, limit));
    if (typeof name !== 'string' || name.length < 1 || name.length > 200) {
      throw apiErrors.validation({ 'x-file-name': 'Send a file name of 1 to 200 characters.' });
    }
    const id = newId('f');
    const sha256 = sha256Hex(bytes);
    try {
      await putObject(fileKey(id), bytes);
      const stored = await getObject(fileKey(id));
      if (stored === null || stored.length !== bytes.length || sha256Hex(stored) !== sha256) {
        throw apiErrors.storageUnavailable();
      }
    } catch (cause) {
      if (cause instanceof StorageDown) throw apiErrors.storageUnavailable();
      throw cause;
    }
    await pool.query('insert into files (id, owner_id, name, bytes, sha256) values ($1, $2, $3, $4, $5)', [
      id,
      session.userId,
      name,
      bytes.length,
      sha256,
    ]);
    ctx.json(201, { file: { id, name, bytes: bytes.length, sha256 } });
  });

  router.add('GET', '/api/files/:id', async (ctx) => {
    const session = ctx.requireSession();
    const result = await pool.query<{ id: string; name: string }>(
      'select id, name from files where id = $1 and owner_id = $2',
      [ctx.params['id'], session.userId],
    );
    if (result.rows[0] === undefined) throw apiErrors.notFound();
    let bytes: Uint8Array | null;
    try {
      bytes = await getObject(fileKey(ctx.params['id']!));
    } catch (cause) {
      if (cause instanceof StorageDown) throw apiErrors.storageUnavailable();
      throw cause;
    }
    if (bytes === null) throw apiErrors.storageUnavailable();
    ctx.bytes(bytes, { 'content-disposition': 'attachment; filename="file.bin"' });
  });

  router.add('POST', '/api/snapshots', async (ctx) => {
    const session = ctx.requireSession();
    const body = await ctx.readJson(bodyLimits.snapshot);
    const fields: FieldErrors = {};
    const steps = validateSteps(body['steps'], fields);
    const ttlCode = typeof body['ttl'] === 'string' ? body['ttl'] : '';
    const ttl = config.limits.shareTtlChoices.find((choice) => choice.code === ttlCode);
    if (ttl === undefined) fields['ttl'] = 'Choose one of the offered expiry times.';
    const output = decodeBase64Field(body['outputBase64'], 'outputBase64', fields);

    let input = new Uint8Array();
    const fileId = body['fileId'];
    if (typeof fileId === 'string') {
      const file = await pool.query('select id from files where id = $1 and owner_id = $2', [fileId, session.userId]);
      if (file.rows[0] === undefined) throw apiErrors.notFound();
      try {
        const stored = await getObject(fileKey(fileId));
        if (stored === null) throw apiErrors.storageUnavailable();
        input = stored;
      } catch (cause) {
        if (cause instanceof StorageDown) throw apiErrors.storageUnavailable();
        throw cause;
      }
    } else {
      input = decodeBase64Field(body['inputBase64'], 'inputBase64', fields);
    }

    let recipeName = 'Unsaved recipe';
    let recipeId: string | null = null;
    let recipeVersion: number | null = null;
    const recipe = body['recipe'];
    if (typeof recipe === 'object' && recipe !== null) {
      const id = (recipe as Record<string, unknown>)['id'];
      const version = (recipe as Record<string, unknown>)['version'];
      if (typeof id === 'string') {
        const summary = await visibleRecipe(id, session.userId);
        if (summary === null) throw apiErrors.notFound();
        recipeId = summary.id;
        recipeName = summary.name;
        recipeVersion = typeof version === 'number' ? version : null;
      }
    }
    if (Object.keys(fields).length > 0) throw apiErrors.validation(fields);

    const createdAt = new Date();
    const row = await createSnapshot({
      ownerId: session.userId,
      recipeName,
      recipeId,
      recipeVersion,
      steps,
      input,
      output,
      createdAt,
      expiresAt: new Date(createdAt.getTime() + ttl!.seconds * 1000),
    });
    ctx.json(201, { snapshot: snapshotBody(row) });
  });

  router.add(
    'GET',
    '/api/snapshots/:token',
    async (ctx) => {
      const row = await findSnapshot(ctx.params['token']!);
      if (row === null) throw apiErrors.notFound();
      ctx.json(200, { snapshot: snapshotBody(row), serverTime: new Date().toISOString() });
    },
    true,
  );

  const download = (which: 'input' | 'output'): Handler => async (ctx) => {
      const row = await findSnapshot(ctx.params['token']!);
      if (row === null) throw apiErrors.notFound();
      const status = snapshotStatus(row);
      if (status === 'revoked') throw apiErrors.snapshotRevoked();
      if (status === 'expired') throw apiErrors.snapshotExpired(row.expires_at.toISOString());
      if (status === 'pending') throw apiErrors.snapshotPending();
      let bytes: Uint8Array | null;
      try {
        bytes = await getObject(which === 'input' ? snapshotInputKey(row.token) : snapshotOutputKey(row.token));
      } catch (cause) {
        if (cause instanceof StorageDown) throw apiErrors.storageUnavailable();
        throw cause;
      }
      if (bytes === null) throw apiErrors.storageUnavailable();
      ctx.bytes(bytes, { 'content-disposition': `attachment; filename="${which}.bin"` });
  };

  router.add('GET', '/api/snapshots/:token/input', download('input'), true);
  router.add('GET', '/api/snapshots/:token/output', download('output'), true);

  router.add('DELETE', '/api/snapshots/:token', async (ctx) => {
    const session = ctx.requireSession();
    const result = await pool.query(
      "update snapshots set status = 'revoked', pending_input = null, pending_output = null where token = $1 and owner_id = $2",
      [ctx.params['token'], session.userId],
    );
    if (result.rowCount === 0) throw apiErrors.notFound();
    ctx.empty(204);
  });
}
