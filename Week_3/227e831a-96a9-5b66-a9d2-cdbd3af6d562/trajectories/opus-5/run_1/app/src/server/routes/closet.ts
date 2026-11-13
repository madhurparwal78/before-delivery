import { randomUUID } from 'node:crypto';
import { detectImageType } from '../../shared/imagetype.js';
import { normaliseName } from '../../shared/normalise.js';
import { transaction, pool, type Db } from '../db.js';
import {
  HttpError,
  conflict,
  notFound,
  storageUnavailable,
  validationFailed,
} from '../http/errors.js';
import { JsonNumber, declaredBody, isPlainObject, present, textOf } from '../http/json.js';
import type { Ctx, Reply, Route } from '../http/pipeline.js';
import { deleteObject, getObject, listObjects, objectExists, putObject } from '../s3.js';
import {
  isUuid,
  loadItemJson,
  loadItemRow,
  loadItems,
  loadProfileRow,
  type ItemRow,
} from '../store.js';
import {
  FieldErrors,
  MESSAGES,
  categoryOf,
  trimmedText,
  weightGramsOf,
  wholeIn,
} from '../validate.js';

const KEY_FORMAT = /^[A-Za-z0-9_-]{1,64}$/;
const CREATE_FIELDS = ['name', 'category', 'weight', 'unitsOwned', 'priceCents', 'notes'] as const;
const RETIRE_FIELDS = ['units', 'reason'] as const;

function canonicalBody(value: unknown): string {
  if (value instanceof JsonNumber) return JSON.stringify(value.value);
  if (Array.isArray(value)) return `[${value.map(canonicalBody).join(',')}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalBody(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

function priceCentsOf(value: unknown, errors: FieldErrors): number | null {
  if (value === null) return null;
  const cents = wholeIn(value, 0, Number.MAX_SAFE_INTEGER);
  if (cents === null) errors.add('priceCents', MESSAGES.priceCents);
  return cents;
}

async function identityTaken(
  db: Db,
  normalised: string,
  category: string,
  exceptId: string | null,
): Promise<boolean> {
  const result = await db.query(
    `SELECT 1 FROM items WHERE normalised_name = $1 AND category = $2 AND ($3::uuid IS NULL OR id <> $3)`,
    [normalised, category, exceptId],
  );
  return result.rows.length > 0;
}

async function itemReply(db: Db, id: string, status: number): Promise<Reply> {
  const profile = await loadProfileRow(db);
  const item = await loadItemJson(db, profile, id);
  if (item === null) throw notFound('item');
  return { status, json: { item } };
}

async function affectedLineCount(db: Db, itemId: string): Promise<number> {
  const result = await db.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
       FROM lines l
       JOIN trip_lists t ON t.id = l.list_id
       JOIN items i ON i.id = l.item_id
      WHERE l.item_id = $1 AND t.state IN ('planning', 'packed') AND l.quantity > i.units_owned`,
    [itemId],
  );
  return Number(result.rows[0]?.count ?? '0');
}

async function runRetirement(ctx: Ctx, item: ItemRow): Promise<Reply> {
  return transaction(async (db) => {
    const locked = await db.query<ItemRow>('SELECT * FROM items WHERE id = $1 FOR UPDATE', [
      item.id,
    ]);
    const current = locked.rows[0];
    if (current === undefined) throw notFound('item');
    if (current.units_owned === 0) {
      throw conflict('item_retired', `${current.name} is already retired.`);
    }
    const body = declaredBody(ctx.body, RETIRE_FIELDS);
    const errors = new FieldErrors();
    const units = wholeIn(body['units'], 1, current.units_owned);
    if (units === null) {
      errors.add('units', `Enter whole units from 1 to ${current.units_owned}.`);
    }
    const reason = textOf(body['reason']);
    if (reason !== 'sold' && reason !== 'retired' && reason !== 'lost') {
      errors.add('reason', MESSAGES.reason);
    }
    errors.throwIfAny();

    const remaining = current.units_owned - (units as number);
    await db.query(
      `UPDATE items SET units_owned = $2, status = $3, version = version + 1 WHERE id = $1`,
      [current.id, remaining, remaining === 0 ? 'retired' : 'active'],
    );
    const profile = await loadProfileRow(db);
    const updated = await loadItemJson(db, profile, current.id);
    return {
      status: 200,
      json: { item: updated, affectedLines: await affectedLineCount(db, current.id) },
    };
  });
}

type KeyClaim =
  | { kind: 'claimed' }
  | { kind: 'in_progress' }
  | { kind: 'reused' }
  | { kind: 'replay'; status: number; response: unknown };

async function claimKey(itemId: string, key: string, body: string): Promise<KeyClaim> {
  const inserted = await pool.query(
    `INSERT INTO retirement_keys (item_id, key, body, state) VALUES ($1, $2, $3, 'in_progress')
     ON CONFLICT (item_id, key) DO NOTHING RETURNING key`,
    [itemId, key, body],
  );
  if (inserted.rows.length > 0) return { kind: 'claimed' };
  const existing = await pool.query<{
    body: string;
    state: string;
    status: number | null;
    response: unknown;
  }>('SELECT body, state, status, response FROM retirement_keys WHERE item_id = $1 AND key = $2', [
    itemId,
    key,
  ]);
  const row = existing.rows[0];
  if (row === undefined) return { kind: 'claimed' };
  if (row.body !== body) return { kind: 'reused' };
  if (row.state === 'in_progress') return { kind: 'in_progress' };
  return { kind: 'replay', status: row.status ?? 200, response: row.response };
}

async function storeKeyResult(
  itemId: string,
  key: string,
  status: number,
  response: unknown,
): Promise<void> {
  await pool.query(
    `UPDATE retirement_keys SET state = 'done', status = $3, response = $4
      WHERE item_id = $1 AND key = $2`,
    [itemId, key, status, JSON.stringify(response)],
  );
}

async function releaseKey(itemId: string, key: string): Promise<void> {
  await pool.query(
    `DELETE FROM retirement_keys WHERE item_id = $1 AND key = $2 AND state = 'in_progress'`,
    [itemId, key],
  );
}

export const closetRoutes: Route[] = [
  {
    method: 'GET',
    pattern: '/api/closet',
    auth: 'owner',
    body: 'json',
    handler: async () => {
      const profile = await loadProfileRow();
      return { status: 200, json: { items: await loadItems(pool, profile) } };
    },
  },
  {
    method: 'POST',
    pattern: '/api/closet',
    auth: 'owner',
    body: 'json',
    handler: async (ctx) => {
      const body = declaredBody(ctx.body, CREATE_FIELDS);
      const errors = new FieldErrors();
      const name = trimmedText(body['name'], 1, 80);
      if (name === null) errors.add('name', MESSAGES.name);
      const category = categoryOf(body['category']);
      if (category === null) errors.add('category', MESSAGES.category);
      const weightGrams = weightGramsOf(body['weight']);
      if (weightGrams === null) errors.add('weight', MESSAGES.weight);
      const unitsOwned = wholeIn(body['unitsOwned'], 1, 99);
      if (unitsOwned === null) errors.add('unitsOwned', MESSAGES.unitsOwned);
      const priceCents = present(body['priceCents'])
        ? priceCentsOf(body['priceCents'], errors)
        : null;
      let notes = '';
      if (present(body['notes'])) {
        const text = textOf(body['notes']);
        if (text === null || text.length > 1000) errors.add('notes', MESSAGES.notes);
        else notes = text;
      }
      errors.throwIfAny();

      return transaction(async (db) => {
        const normalised = normaliseName(name as string);
        if (await identityTaken(db, normalised, category as string, null)) {
          throw conflict('item_exists', 'You already own gear with that name in that category.');
        }
        const inserted = await db.query<{ id: string }>(
          `INSERT INTO items (name, normalised_name, category, weight_grams, units_owned, price_cents, notes)
           VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
          [name, normalised, category, weightGrams, unitsOwned, priceCents, notes],
        );
        return itemReply(db, (inserted.rows[0] as { id: string }).id, 201);
      });
    },
  },
  {
    method: 'PATCH',
    pattern: '/api/closet/:id',
    auth: 'owner',
    body: 'json',
    handler: async (ctx) => {
      const existing = await loadItemRow(pool, ctx.params['id'] as string);
      if (existing === null) throw notFound('item');
      const ifMatch = ctx.req.headers['if-match'];
      if (ifMatch === undefined) {
        throw new HttpError(428, 'precondition_required', 'Send the version you last saw.');
      }
      return transaction(async (db) => {
        const locked = await db.query<ItemRow>('SELECT * FROM items WHERE id = $1 FOR UPDATE', [
          existing.id,
        ]);
        const current = locked.rows[0];
        if (current === undefined) throw notFound('item');
        if (ifMatch !== `"${current.version}"`) {
          throw new HttpError(412, 'item_changed', `${current.name} changed on another device.`);
        }
        if (current.status === 'retired') {
          throw conflict('item_retired', `${current.name} is retired.`);
        }
        const body = declaredBody(ctx.body, CREATE_FIELDS);
        const errors = new FieldErrors();
        const updates: string[] = [];
        const values: unknown[] = [current.id];
        let name = current.name;
        let category: string = current.category;

        if (present(body['name'])) {
          const parsed = trimmedText(body['name'], 1, 80);
          if (parsed === null) errors.add('name', MESSAGES.name);
          else {
            name = parsed;
            updates.push(`name = $${values.push(parsed)}`);
            updates.push(`normalised_name = $${values.push(normaliseName(parsed))}`);
          }
        }
        if (present(body['category'])) {
          const parsed = categoryOf(body['category']);
          if (parsed === null) errors.add('category', MESSAGES.category);
          else {
            category = parsed;
            updates.push(`category = $${values.push(parsed)}`);
          }
        }
        if (present(body['weight'])) {
          const grams = weightGramsOf(body['weight']);
          if (grams === null) errors.add('weight', MESSAGES.weight);
          else updates.push(`weight_grams = $${values.push(grams)}`);
        }
        if (present(body['unitsOwned'])) {
          const units = wholeIn(body['unitsOwned'], 1, 99);
          if (units === null) errors.add('unitsOwned', MESSAGES.unitsOwned);
          else if (units < current.units_owned) {
            errors.add('unitsOwned', 'Use retire to reduce units owned.');
          } else updates.push(`units_owned = $${values.push(units)}`);
        }
        if (present(body['priceCents'])) {
          const cents = priceCentsOf(body['priceCents'], errors);
          updates.push(`price_cents = $${values.push(cents)}`);
        }
        if (present(body['notes'])) {
          const text = textOf(body['notes']);
          if (text === null || text.length > 1000) errors.add('notes', MESSAGES.notes);
          else updates.push(`notes = $${values.push(text)}`);
        }
        errors.throwIfAny();

        if (await identityTaken(db, normaliseName(name), category, current.id)) {
          throw conflict('item_exists', 'You already own gear with that name in that category.');
        }
        await db.query(
          `UPDATE items SET ${[...updates, 'version = version + 1'].join(', ')} WHERE id = $1`,
          values,
        );
        return itemReply(db, current.id, 200);
      });
    },
  },
  {
    method: 'POST',
    pattern: '/api/closet/:id/retire',
    auth: 'owner',
    body: 'json',
    handler: async (ctx) => {
      const item = await loadItemRow(pool, ctx.params['id'] as string);
      if (item === null) throw notFound('item');
      const header = ctx.req.headers['idempotency-key'];
      const key = Array.isArray(header) ? header[0] : header;
      if (key === undefined) return runRetirement(ctx, item);
      if (!KEY_FORMAT.test(key)) {
        throw validationFailed({
          'Idempotency-Key': 'Send a key of 1 to 64 letters, digits, - or _.',
        });
      }
      const claim = await claimKey(item.id, key, canonicalBody(ctx.body));
      if (claim.kind === 'in_progress') {
        throw conflict('request_in_progress', 'This retirement is still being processed.');
      }
      if (claim.kind === 'reused') {
        throw new HttpError(
          422,
          'idempotency_key_reused',
          'This key was already used for a different retirement.',
        );
      }
      if (claim.kind === 'replay') {
        return { status: claim.status, json: claim.response };
      }
      try {
        const reply = await runRetirement(ctx, item);
        await storeKeyResult(item.id, key, reply.status, reply.json);
        return reply;
      } catch (error) {
        if (error instanceof HttpError && (error.status === 409 || error.status === 422)) {
          await storeKeyResult(item.id, key, error.status, error.body());
          throw error;
        }
        await releaseKey(item.id, key);
        throw error;
      }
    },
  },
  {
    method: 'DELETE',
    pattern: '/api/closet/:id',
    auth: 'owner',
    body: 'json',
    handler: async (ctx) => {
      const item = await loadItemRow(pool, ctx.params['id'] as string);
      if (item === null) throw notFound('item');
      const used = await pool.query('SELECT 1 FROM lines WHERE item_id = $1', [item.id]);
      if (used.rows.length > 0) {
        throw conflict('item_in_lists', `${item.name} is on a trip list and can't be deleted.`);
      }
      if (item.photo_id !== null) {
        const prefix = `photos/${item.id}/`;
        for (const key of await listObjects(prefix)) {
          await deleteObject(key);
        }
        if ((await listObjects(prefix)).length > 0) throw storageUnavailable();
      }
      await pool.query('DELETE FROM items WHERE id = $1', [item.id]);
      return { status: 204 };
    },
  },
  {
    method: 'POST',
    pattern: '/api/closet/:id/photo',
    auth: 'owner',
    body: 'photo',
    handler: async (ctx) => {
      const item = await loadItemRow(pool, ctx.params['id'] as string);
      if (item === null) throw notFound('item');
      if (item.status === 'retired') {
        throw conflict('item_retired', `${item.name} is retired.`);
      }
      const part = ctx.parts.find((candidate) => candidate.name === 'photo');
      const type = part === undefined ? null : detectImageType(part.bytes);
      if (part === undefined || part.bytes.length === 0 || type === null) {
        throw validationFailed({ photo: 'Use a JPEG, PNG or WebP image.' });
      }
      const photoId = randomUUID();
      const key = `photos/${item.id}/${photoId}.${type.ext}`;
      await putObject(key, part.bytes, type.contentType);
      if (!(await objectExists(key))) throw storageUnavailable();
      const previous = await pool.query<{ object_key: string }>(
        'SELECT object_key FROM photos WHERE item_id = $1',
        [item.id],
      );
      await transaction(async (db) => {
        await db.query(
          'INSERT INTO photos (id, item_id, object_key, content_type) VALUES ($1, $2, $3, $4)',
          [photoId, item.id, key, type.contentType],
        );
        await db.query('UPDATE items SET photo_id = $2, version = version + 1 WHERE id = $1', [
          item.id,
          photoId,
        ]);
        await db.query('DELETE FROM photos WHERE item_id = $1 AND id <> $2', [item.id, photoId]);
      });
      for (const old of previous.rows) {
        await deleteObject(old.object_key);
      }
      return {
        status: 201,
        json: { photo: { id: photoId, status: 'ready', url: `/api/photos/${photoId}` } },
      };
    },
  },
  {
    method: 'GET',
    pattern: '/api/photos/:photoId',
    auth: 'owner',
    body: 'json',
    handler: async (ctx) => {
      const id = ctx.params['photoId'] as string;
      if (!isUuid(id)) throw notFound('photo');
      const photo = await pool.query<{ object_key: string; content_type: string }>(
        `SELECT p.object_key, p.content_type FROM photos p
           JOIN items i ON i.photo_id = p.id WHERE p.id = $1`,
        [id],
      );
      const row = photo.rows[0];
      if (row === undefined) throw notFound('photo');
      const bytes = await getObject(row.object_key);
      if (bytes === null) throw notFound('photo');
      return {
        status: 200,
        bytes,
        contentType: row.content_type,
        headers: { 'x-content-type-options': 'nosniff' },
      };
    },
  },
];
