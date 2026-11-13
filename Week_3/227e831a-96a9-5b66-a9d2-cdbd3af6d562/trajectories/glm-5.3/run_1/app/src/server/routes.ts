import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AppContext } from './main.js';
import {
  ApiError,
  crossSiteRequest,
  emptyList,
  internalError,
  invalidPassphrase,
  itemChanged,
  itemExists,
  itemInLists,
  itemRetired,
  linesNotInCloset,
  listNotFound,
  listNotEditable,
  notFound,
  payloadTooLarge,
  preconditionRequired,
  readOnly,
  shareNotFound,
  storageUnavailable,
  unauthenticated,
  unknownRoute,
  unsupportedMediaType,
  validationFailed,
  printingUnavailable,
  lineNotFound,
  lineExists,
  illegalTransition,
  importCommitted,
  requestInProgress,
  idempotencyKeyReused,
} from './errors.js';
import { SESSION_COOKIE, createSession, endSession, hashPassphrase, newId, newShareToken, passphraseMatches, sessionLive } from './sessions.js';
import { readJson } from './middleware.js';
import { applySyncOp, listAnswer, lineFromRow, packSheetHtml, retireItem, type HikerProfileRow } from './actions.js';
import { currentContent, deriveForList, isCurrent, itemJson, itemStock, listJson, packedInCounts, readHiker, readItems, readItemsById, readLines, readList, readLists, readSheets, sheetJson, type ItemRow, type LineRow, type ListRow } from './reads.js';
import { sheetContentKey } from '../domain/sheet.js';
import { deriveList } from '../domain/derived.js';
import { formatWeight, goalDeltaText } from '../domain/format.js';
import type { DisplayUnit } from '../domain/types.js';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { CSV_LIMIT, JSON_BODY_LIMIT, PHOTO_LIMIT } from './limits.js';
import { detectPhotoType, PHOTO_CONTENT_TYPES, PHOTO_EXTENSIONS } from '../domain/photo.js';
import { CATEGORIES, type Category, type CarryMode, type ListState } from '../domain/types.js';
import { canonicalCategory } from '../domain/types.js';
import { convertToGrams, type WeightInputUnit } from '../domain/weights.js';
import { normaliseName } from '../domain/names.js';
import { checkListStateMove } from '../domain/listState.js';
import { shareExpired, todayInZone } from '../domain/share.js';
import { invalidOpReason, sameOp, type SyncOp } from '../domain/sync.js';
import { ImportFileError, parsePrice, readImportFile } from '../domain/import.js';
import type { Db } from './db.js';
import { renderPdf } from './printing.js';
import { StorageUnavailableError, type Storage } from './storage.js';

const CLOSET_MESSAGES = {
  name: 'Enter a name.',
  category: 'Choose a category.',
  weight: 'Enter a weight from 0 to 50000 g.',
  unitsOwned: 'Enter whole units from 1 to 99.',
  priceCents: 'Enter a price of 0 or more.',
  notes: 'Notes can be at most 1000 characters.',
} as const;

/**
 * Every route. The order of checks follows the published error precedence:
 * body limit, content type, cross-site, session, 404, then the route's own
 * state checks, then validation.
 */
export async function registerRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const { db, storage, config } = ctx;
  // ---- Cross-site writes: checked before the session, after limit and type.
  const guardCrossSite = (request: FastifyRequest): void => {
    const origin = request.headers.origin;
    const fetchSite = request.headers['sec-fetch-site'];
    if (typeof fetchSite === 'string' && fetchSite === 'cross-site') throw crossSiteRequest();
    if (origin !== undefined) {
      if (origin === 'null') throw crossSiteRequest();
      const host = request.headers.host;
      try {
        const originUrl = new URL(origin);
        if (typeof host !== 'string' || originUrl.host !== host) throw crossSiteRequest();
      } catch {
        throw crossSiteRequest();
      }
    }
  };

  const requireSession = async (request: FastifyRequest): Promise<void> => {
    const token = readSessionToken(request);
    if (!(await sessionLive(db, token))) throw unauthenticated();
  };

  const readSessionToken = (request: FastifyRequest): string | undefined => {
    const header = request.headers.cookie;
    if (typeof header !== 'string') return undefined;
    for (const part of header.split(';')) {
      const [name, ...rest] = part.trim().split('=');
      if (name === SESSION_COOKIE) return rest.join('=');
    }
    return undefined;
  };

  const validTimeZone = (value: string): boolean => {
    try {
      new Intl.DateTimeFormat('en-CA', { timeZone: value }).format(new Date());
      return true;
    } catch {
      return false;
    }
  };

  const requireJson = (request: FastifyRequest): void => {
    const type = request.headers['content-type'];
    if (type !== undefined && !type.startsWith('application/json')) throw unsupportedMediaType();
  };

  // ---- Helpers shared by the routes below.

  const hiker = async () => {
    const row = await readHiker(db);
    if (row === null) throw unauthenticated();
    return row;
  };

  const closetWriteError = (fields: Record<string, string>): ApiError => validationFailed(fields);

  /** Validates a weight input object: {"value": number-as-written, "unit"}. */
  const parseWeightInput = (value: unknown, field: string): number | null => {
    if (typeof value !== 'object' || value === null) return null;
    const record = value as Record<string, unknown>;
    const unit = record['unit'];
    if (unit !== 'g' && unit !== 'oz' && unit !== 'lb' && unit !== 'kg') return null;
    const raw = record['value'];
    let text: string;
    if (typeof raw === 'number') {
      text = String(raw);
    } else if (typeof raw === 'string') {
      text = raw;
    } else {
      return null;
    }
    const grams = convertToGrams(text, unit);
    void field;
    return grams;
  };

  const itemById = async (id: string): Promise<ItemRow> => {
    const rows = await db`SELECT id, name, category, weight_grams, units_owned, status, price_cents, notes, photo_id, version FROM closet_items WHERE id = ${id}`;
    const row = rows[0] as unknown as ItemRow | undefined;
    if (row === undefined) throw notFound('item');
    return row;
  };

  const listById = async (id: string): Promise<ListRow> => {
    const list = await readList(db, id);
    if (list === null) throw listNotFound();
    return list;
  };

  const identityExists = async (name: string, category: Category): Promise<boolean> => {
    const rows = await db`SELECT id FROM closet_items WHERE category = ${category} AND lower(regexp_replace(trim(name), '\\s+', ' ', 'g')) = ${normaliseName(name)}`;
    return rows.length > 0;
  };

  const photoJson = (photoId: string | null): { id: string; url: string } | null => {
    if (photoId === null) return null;
    return { id: photoId, url: `/api/photos/${photoId}` };
  };

  // ---- Session and health.

  app.get('/api/health', async () => {
    try {
      await db`SELECT 1`;
      return { status: 'ok' };
    } catch {
      return { status: 'starting' };
    }
  });

  app.post('/api/session', async (request, reply) => {
    guardCrossSite(request);
    const body = await readJson(request);
    const passphrase = body['passphrase'];
    if (typeof passphrase !== 'string') throw validationFailed({ passphrase: 'Enter the passphrase.' });
    const hikerRow = await db`SELECT passphrase_hash FROM hiker WHERE id = 1`;
    const stored = hikerRow[0]?.passphrase_hash as string | undefined;
    if (stored === undefined || !passphraseMatches(passphrase, stored)) throw invalidPassphrase();
    const token = await createSession(db);
    void reply
      .status(204)
      .header('Set-Cookie', `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax`)
      .send();
  });

  app.delete('/api/session', async (request, reply) => {
    guardCrossSite(request);
    const token = readSessionToken(request);
    if (token !== undefined) await endSession(db, token);
    void reply.status(204).header('Set-Cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`).send();
  });

  // ---- Profile.

  app.get('/api/profile', async (request) => {
    await requireSession(request);
    const profile = await hiker();
    return { profile: { displayName: profile.displayName, unit: profile.unit, goalGrams: profile.goalGrams, goalDisplay: goalDisplayText(profile), timeZone: profile.timeZone, paperSize: profile.paperSize } };
  });

  app.patch('/api/profile', async (request) => {
    guardCrossSite(request);
    await requireSession(request);
    requireJson(request);
    const body = await readJson(request);
    const unknown: Record<string, string> = {};
    const allowed = new Set(['displayName', 'unit', 'goal', 'timeZone', 'paperSize']);
    for (const key of Object.keys(body)) {
      if (!allowed.has(key)) unknown[key] = "This field can't be set.";
    }
    if (Object.keys(unknown).length > 0) throw validationFailed(unknown);
    const fields: Record<string, string> = {};
    const updates: Record<string, unknown> = {};
    const displayName = body['displayName'];
    if (displayName !== undefined) {
      if (typeof displayName !== 'string' || displayName.trim().length < 1 || displayName.trim().length > 60) fields.displayName = 'Enter a display name of up to 60 characters.';
      else updates.display_name = displayName.trim();
    }
    const unit = body['unit'];
    if (unit !== undefined) {
      if (unit !== 'g' && unit !== 'oz' && unit !== 'lb') fields.unit = 'Choose a display unit.';
      else updates.unit = unit;
    }
    const goal = body['goal'];
    if (goal !== undefined) {
      const grams = parseWeightInput(goal, 'goal');
      if (grams === null || grams < 1 || grams > 50000) fields.goal = 'Enter a goal from 1 to 50000 g.';
      else updates.goal_grams = grams;
    }
    const timeZone = body['timeZone'];
    if (timeZone !== undefined) {
      if (typeof timeZone !== 'string' || !validTimeZone(timeZone)) fields.timeZone = 'Choose a time zone.';
      else updates.time_zone = timeZone;
    }
    const paperSize = body['paperSize'];
    if (paperSize !== undefined) {
      if (paperSize !== 'A4' && paperSize !== 'Letter') fields.paperSize = 'Choose A4 or Letter.';
      else updates.paper_size = paperSize;
    }
    if (Object.keys(fields).length > 0) throw closetWriteError(fields);
    if (Object.keys(updates).length > 0) {
      // The column names come from the route's own declared fields only.
      const entries = Object.entries(updates);
      const sets = entries.map(([key], index) => `"${snakeCase(key)}" = $${index + 1}`).join(', ');
      await db.unsafe(`UPDATE hiker SET ${sets} WHERE id = 1`, entries.map(([, value]) => value));
    }
    const profile = await hiker();
    return { profile: { displayName: profile.displayName, unit: profile.unit, goalGrams: profile.goalGrams, goalDisplay: goalDisplayText(profile), timeZone: profile.timeZone, paperSize: profile.paperSize } };
  });

  // ---- Closet.

  app.get('/api/closet', async (request) => {
    await requireSession(request);
    const profile = await hiker();
    const [items, packed] = await Promise.all([readItems(db), packedInCounts(db)]);
    const active = items.filter((row) => row.status === 'active');
    const retired = items.filter((row) => row.status === 'retired');
    const sorted = [...orderByCategory(active), ...orderByCategory(retired)];
    return { items: sorted.map((row) => itemJson(row, packed.get(row.id) ?? 0, photoJson(row.photo_id), profile.unit)) };
  });

  app.post('/api/closet', async (request, reply) => {
    guardCrossSite(request);
    await requireSession(request);
    requireJson(request);
    const body = await readJson(request);
    const unknown: Record<string, string> = {};
    const allowed = new Set(['name', 'category', 'weight', 'unitsOwned', 'priceCents', 'notes']);
    for (const key of Object.keys(body)) {
      if (!allowed.has(key)) unknown[key] = "This field can't be set.";
    }
    if (Object.keys(unknown).length > 0) throw validationFailed(unknown);
    const fields: Record<string, string> = {};
    const name = body['name'];
    if (typeof name !== 'string' || name.trim().length < 1 || name.trim().length > 80) fields.name = CLOSET_MESSAGES.name;
    const category = body['category'];
    const canonical = typeof category === 'string' ? canonicalCategory(category) : null;
    if (canonical === null) fields.category = CLOSET_MESSAGES.category;
    const weight = parseWeightInput(body['weight'], 'weight');
    if (weight === null) fields.weight = CLOSET_MESSAGES.weight;
    const unitsOwned = body['unitsOwned'];
    if (typeof unitsOwned !== 'number' || !Number.isInteger(unitsOwned) || unitsOwned < 1 || unitsOwned > 99) fields.unitsOwned = CLOSET_MESSAGES.unitsOwned;
    const priceCents = body['priceCents'];
    let price: number | null = null;
    if (priceCents !== undefined && priceCents !== null) {
      if (typeof priceCents !== 'number' || !Number.isInteger(priceCents) || priceCents < 0) fields.priceCents = CLOSET_MESSAGES.priceCents;
      else price = priceCents;
    }
    const notes = body['notes'];
    if (notes !== undefined && (typeof notes !== 'string' || notes.length > 1000)) fields.notes = CLOSET_MESSAGES.notes;
    if (Object.keys(fields).length > 0) throw closetWriteError(fields);
    const trimmedName = (name as string).trim();
    if (await identityExists(trimmedName, canonical as Category)) throw itemExists();
    const id = newId();
    const notesText = typeof notes === 'string' ? notes : '';
    await db`INSERT INTO closet_items (id, name, category, weight_grams, units_owned, status, price_cents, notes, photo_id, version) VALUES (${id}, ${trimmedName}, ${canonical as string}, ${weight as number}, ${unitsOwned as number}, 'active', ${price}, ${notesText}, NULL, 1)`;
    const row = await itemById(id);
    const profile = await hiker();
    const packed = await packedInCounts(db);
    void reply.status(201).send({ item: itemJson(row, packed.get(id) ?? 0, photoJson(row.photo_id), profile.unit) });
  });

  app.patch('/api/closet/:id', async (request) => {
    guardCrossSite(request);
    await requireSession(request);
    requireJson(request);
    const { id } = request.params as { id: string };
    const body = await readJson(request);
    const unknown: Record<string, string> = {};
    const allowed = new Set(['name', 'category', 'weight', 'unitsOwned', 'priceCents', 'notes']);
    for (const key of Object.keys(body)) {
      if (!allowed.has(key)) unknown[key] = "This field can't be set.";
    }
    if (Object.keys(unknown).length > 0) throw validationFailed(unknown);
    const row = await itemById(id);
    if (row.status === 'retired') throw itemRetired(row.name);
    // Version checks come at their place in the precedence order: after 401
    // and 404, before every other check on this route.
    const match = request.headers['if-match'];
    if (match === undefined) throw preconditionRequired();
    const matchText = Array.isArray(match) ? match[0]! : match;
    if (matchText !== `"${row.version}"`) throw itemChanged(row.name);

    const fields: Record<string, string> = {};
    const updates: Record<string, unknown> = {};
    if ('name' in body) {
      const name = body['name'];
      if (typeof name !== 'string' || name.trim().length < 1 || name.trim().length > 80) fields.name = CLOSET_MESSAGES.name;
      else updates.name = name.trim();
    }
    let category: Category | null = null;
    if ('category' in body) {
      const value = body['category'];
      category = typeof value === 'string' ? canonicalCategory(value) : null;
      if (category === null) fields.category = CLOSET_MESSAGES.category;
      else updates.category = category;
    }
    if ('weight' in body) {
      const grams = parseWeightInput(body['weight'], 'weight');
      if (grams === null) fields.weight = CLOSET_MESSAGES.weight;
      else updates.weight_grams = grams;
    }
    if ('unitsOwned' in body) {
      const unitsOwned = body['unitsOwned'];
      if (typeof unitsOwned !== 'number' || !Number.isInteger(unitsOwned) || unitsOwned < 1 || unitsOwned > 99) fields.unitsOwned = CLOSET_MESSAGES.unitsOwned;
      else if (unitsOwned < row.units_owned) fields.unitsOwned = 'Use retire to reduce units owned.';
      else updates.units_owned = unitsOwned;
    }
    if ('priceCents' in body) {
      const priceCents = body['priceCents'];
      if (priceCents === null) updates.price_cents = null;
      else if (typeof priceCents !== 'number' || !Number.isInteger(priceCents) || priceCents < 0) fields.priceCents = CLOSET_MESSAGES.priceCents;
      else updates.price_cents = priceCents;
    }
    if ('notes' in body) {
      const notes = body['notes'];
      if (typeof notes !== 'string' || notes.length > 1000) fields.notes = CLOSET_MESSAGES.notes;
      else updates.notes = notes;
    }
    if (Object.keys(fields).length > 0) throw closetWriteError(fields);
    const nextName = (updates.name as string | undefined) ?? row.name;
    const nextCategory = (updates.category as Category | undefined) ?? row.category;
    if (updates.name !== undefined || updates.category !== undefined) {
      const clash = await db`SELECT id FROM closet_items WHERE category = ${nextCategory} AND lower(regexp_replace(trim(name), '\\s+', ' ', 'g')) = ${normaliseName(nextName)} AND id <> ${id}`;
      if (clash.length > 0) throw itemExists();
    }
    // Serialised against a simultaneous edit of the same version.
    const updatesSql: Record<string, unknown> = {};
    if (updates.name !== undefined) updatesSql.name = updates.name;
    if (updates.category !== undefined) updatesSql.category = updates.category;
    if (updates.weight_grams !== undefined) updatesSql.weight_grams = updates.weight_grams;
    if (updates.units_owned !== undefined) updatesSql.units_owned = updates.units_owned;
    if (updates.price_cents !== undefined) updatesSql.price_cents = updates.price_cents;
    if (updates.notes !== undefined) updatesSql.notes = updates.notes;
    // Serialised against a simultaneous edit of the same version: the WHERE
    // clause on the current version makes exactly one of them land.
    const entries = Object.entries(updatesSql);
    const sets = entries.map(([column], index) => `"${column}" = $${index + 1}`).concat([`version = $${entries.length + 1}`]).join(', ');
    const values = entries.map(([, value]) => value).concat([row.version + 1]);
    const result = await db.unsafe(
      `UPDATE closet_items SET ${sets} WHERE id = $${values.length + 1} AND version = $${values.length + 2} RETURNING id`,
      [...values, id, row.version],
    );
    if (result.length === 0) throw itemChanged(row.name);
    const updated = await itemById(id);
    const profile = await hiker();
    const packed = await packedInCounts(db);
    return { item: itemJson(updated, packed.get(id) ?? 0, photoJson(updated.photo_id), profile.unit) };
  });

  // ---- Retire, with the retry-safe key log.

  app.post('/api/closet/:id/retire', async (request, reply) => {
    guardCrossSite(request);
    await requireSession(request);
    requireJson(request);
    const { id } = request.params as { id: string };
    const body = await readJson(request);
    const unknown: Record<string, string> = {};
    for (const key of Object.keys(body)) {
      if (key !== 'units' && key !== 'reason') unknown[key] = "This field can't be set.";
    }
    if (Object.keys(unknown).length > 0) throw validationFailed(unknown);
    const row = await itemById(id);

    // The key check sits after 401 and 404, before every other check.
    const keyHeader = request.headers['idempotency-key'];
    const key = keyHeader === undefined ? undefined : (Array.isArray(keyHeader) ? keyHeader[0] : keyHeader);
    if (key !== undefined && !/^[A-Za-z0-9_-]{1,64}$/.test(key)) {
      throw validationFailed({ 'Idempotency-Key': 'Send a key of 1 to 64 letters, digits, - or _.' });
    }

    const fields: Record<string, string> = {};
    const units = body['units'];
    if (typeof units !== 'number' || !Number.isInteger(units) || units < 1 || units > row.units_owned) {
      fields.units = row.units_owned === 0 ? `Enter whole units from 1 to ${row.units_owned}.` : `Enter whole units from 1 to ${row.units_owned}.`;
    }
    const reason = body['reason'];
    if (reason !== 'sold' && reason !== 'retired' && reason !== 'lost') fields.reason = 'Choose a reason.';
    if (Object.keys(fields).length > 0) throw closetWriteError(fields);

    if (row.units_owned === 0) throw itemRetired(row.name);

    if (key !== undefined) {
      const remembered = await db`SELECT request_body, status_code, response_body FROM retirement_keys WHERE key = ${key} AND item_id = ${id}`;
      const stored = remembered[0];
      if (stored !== undefined) {
        const sameBody = sameJson(stored.request_body as unknown, body);
        if (!sameBody) throw idempotencyKeyReused();
        // A replay returns the stored status and body byte for byte, changing nothing.
        void reply.status(Number(stored.status_code)).send(stored.response_body);
        return;
      }
      // Reserve the key so a simultaneous request under it is refused as in progress.
      const reserved = await db`INSERT INTO retirement_keys (key, item_id, request_body, status_code, response_body) VALUES (${key}, ${id}, ${JSON.stringify(body)}, 0, '{}') ON CONFLICT DO NOTHING RETURNING key`;
      if (reserved.length === 0) throw requestInProgress();
    }

    const answer = await retireItem(db, id, row, units as number, reason as string);
    if (key !== undefined) {
      await db`UPDATE retirement_keys SET status_code = ${answer.status}, response_body = ${JSON.stringify(answer.body)} WHERE key = ${key} AND item_id = ${id}`;
    }
    // The stored status is the HTTP status; the stored body is the answer body.
    void reply.status(answer.status).send(answer.body);
  });

  // ---- Delete: only gear no list has ever used, photo removed from storage first.

  app.delete('/api/closet/:id', async (request, reply) => {
    guardCrossSite(request);
    await requireSession(request);
    const { id } = request.params as { id: string };
    const row = await itemById(id);
    const used = await db`SELECT id FROM lines WHERE item_id = ${id} LIMIT 1`;
    if (used.length > 0) throw itemInLists();
    if (row.photo_id !== null) {
      try {
        await storage.deletePrefix(`photos/${id}/`);
      } catch {
        throw storageUnavailable();
      }
    }
    await db`DELETE FROM closet_items WHERE id = ${id}`;
    void reply.status(204).send();
  });

  // ---- Photos: type decided from the file's leading bytes only.

  app.post('/api/closet/:id/photo', async (request, reply) => {
    guardCrossSite(request);
    await requireSession(request);
    const { id } = request.params as { id: string };
    const row = await itemById(id);
    if (row.status === 'retired') throw itemRetired(row.name);
    const file = await request.file();
    if (file === undefined) throw validationFailed({ photo: 'Use a JPEG, PNG or WebP image.' });
    const bytes = await readStream(file.file);
    if (bytes.length === 0 || bytes.length > PHOTO_LIMIT) {
      if (bytes.length > PHOTO_LIMIT) throw payloadTooLarge();
      throw validationFailed({ photo: 'Use a JPEG, PNG or WebP image.' });
    }
    const type = detectPhotoType(bytes);
    if (type === null) throw validationFailed({ photo: 'Use a JPEG, PNG or WebP image.' });
    const photoId = newId();
    const key = `photos/${id}/${photoId}.${PHOTO_EXTENSIONS[type]}`;
    try {
      await storage.put(key, bytes, PHOTO_CONTENT_TYPES[type]);
    } catch {
      throw storageUnavailable();
    }
    const previous = row.photo_id;
    await db.begin(async (tx) => {
      await tx`DELETE FROM photos WHERE item_id = ${id}`;
      await tx`INSERT INTO photos (id, item_id, extension) VALUES (${photoId}, ${id}, ${PHOTO_EXTENSIONS[type]})`;
      await tx`UPDATE closet_items SET photo_id = ${photoId}, version = version + 1 WHERE id = ${id}`;
    });
    if (previous !== null) {
      try {
        await storage.delete(`photos/${id}/${previous}.${await photoExtension(db, previous)}`);
      } catch {
        // The earlier object is already unlinked from the item; leaving it is safe.
      }
    }
    void reply.status(201).send({ photo: { id: photoId, status: 'ready', url: `/api/photos/${photoId}` } });
  });

  app.get('/api/photos/:photoId', async (request, reply) => {
    await requireSession(request);
    const { photoId } = request.params as { photoId: string };
    const rows = await db`SELECT p.id, p.item_id, p.extension, c.photo_id FROM photos p JOIN closet_items c ON c.id = p.item_id WHERE p.id = ${photoId}`;
    const row = rows[0];
    if (row === undefined || row.photo_id !== photoId) throw notFound('photo');
    let bytes: Uint8Array;
    try {
      bytes = await storage.get(`photos/${row.item_id}/${photoId}.${row.extension}`);
    } catch {
      throw storageUnavailable();
    }
    void reply
      .status(200)
      .header('Content-Type', PHOTO_CONTENT_TYPES[row.extension as 'jpeg' | 'png' | 'webp'])
      .header('X-Content-Type-Options', 'nosniff')
      .header('Cache-Control', 'no-store')
      .send(Buffer.from(bytes));
  });

  // ---- Lists and lines.

  app.get('/api/lists', async (request) => {
    await requireSession(request);
    const profile = await hiker();
    const lists = await readLists(db);
    const stock = await readItemsById(db);
    const stockMap = new Map([...stock.values()].map((row) => [row.id, itemStock(row)]));
    const summaries = [];
    for (const list of lists) {
      const lines = await readLines(db, list.id);
      const lineLikes = lines.map((row) => lineFromRow(row, list.state, stock));
      const derived = deriveList(lineLikes, list.state, stockMap, profile.goalGrams, profile.unit);
      summaries.push({ id: list.id, name: list.name, state: list.state, totals: derived.totals });
    }
    return { lists: summaries };
  });

  app.post('/api/lists', async (request, reply) => {
    guardCrossSite(request);
    await requireSession(request);
    requireJson(request);
    const body = await readJson(request);
    const unknown: Record<string, string> = {};
    for (const key of Object.keys(body)) {
      if (key !== 'name') unknown[key] = "This field can't be set.";
    }
    if (Object.keys(unknown).length > 0) throw validationFailed(unknown);
    const name = body['name'];
    if (typeof name !== 'string' || name.trim().length < 1 || name.trim().length > 80) {
      throw validationFailed({ name: 'Enter a list name of up to 80 characters.' });
    }
    const id = newId();
    await db`INSERT INTO lists (id, name, state) VALUES (${id}, ${name.trim()}, 'planning')`;
    const list = await listById(id);
    const profile = await hiker();
    const [lines, stock] = await Promise.all([readLines(db, id), readItemsById(db)]);
    const derived = deriveForList(list, lines, stock, profile.goalGrams, profile.unit);
    void reply.status(201).send({ list: listJson(list, derived) });
  });

  app.get('/api/lists/:id', async (request) => {
    await requireSession(request);
    const { id } = request.params as { id: string };
    const list = await listById(id);
    const profile = await hiker();
    const [lines, stock] = await Promise.all([readLines(db, id), readItemsById(db)]);
    const derived = deriveForList(list, lines, stock, profile.goalGrams, profile.unit);
    return { list: listJson(list, derived) };
  });

  app.patch('/api/lists/:id', async (request) => {
    guardCrossSite(request);
    await requireSession(request);
    requireJson(request);
    const { id } = request.params as { id: string };
    const body = await readJson(request);
    const unknown: Record<string, string> = {};
    for (const key of Object.keys(body)) {
      if (key !== 'name') unknown[key] = "This field can't be set.";
    }
    if (Object.keys(unknown).length > 0) throw validationFailed(unknown);
    const list = await listById(id);
    if (list.state === 'walked') throw listNotEditable(list.name, list.state);
    const name = body['name'];
    if (typeof name !== 'string' || name.trim().length < 1 || name.trim().length > 80) {
      throw validationFailed({ name: 'Enter a list name of up to 80 characters.' });
    }
    await db`UPDATE lists SET name = ${name.trim()} WHERE id = ${id}`;
    return await listAnswer(db, id);
  });

  app.post('/api/lists/:id/lines', async (request, reply) => {
    guardCrossSite(request);
    await requireSession(request);
    requireJson(request);
    const { id } = request.params as { id: string };
    const body = await readJson(request);
    const unknown: Record<string, string> = {};
    for (const key of Object.keys(body)) {
      if (key !== 'itemId' && key !== 'quantity' && key !== 'mode') unknown[key] = "This field can't be set.";
    }
    if (Object.keys(unknown).length > 0) throw validationFailed(unknown);
    const list = await listById(id);
    const itemId = body['itemId'];
    if (typeof itemId !== 'string') throw validationFailed({ itemId: 'Choose a piece of gear.' });
    const item = await itemById(itemId);
    // 409 checks in order: list_not_editable, item_retired, line_exists.
    if (list.state !== 'planning') throw listNotEditable(list.name, list.state);
    if (item.units_owned === 0) throw itemRetired(item.name);
    const existing = await db`SELECT id FROM lines WHERE list_id = ${id} AND item_id = ${itemId}`;
    if (existing.length > 0) throw lineExists();
    let quantity = 1;
    if (body['quantity'] !== undefined) {
      const value = body['quantity'];
      if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) throw validationFailed({ quantity: 'Quantity must be at least 1.' });
      quantity = value;
    }
    let mode: CarryMode = 'base';
    if (body['mode'] !== undefined) {
      const value = body['mode'];
      if (value !== 'base' && value !== 'worn' && value !== 'consumable') throw validationFailed({ mode: 'Choose base, worn or consumable.' });
      mode = value;
    }
    if (quantity > item.units_owned) throw validationFailed({ quantity: `You own ${item.units_owned}.` });
    const lineId = newId();
    const position = await nextPosition(db, id);
    await db`INSERT INTO lines (id, list_id, item_id, quantity, mode, name, unit_weight_grams, position) VALUES (${lineId}, ${id}, ${itemId}, ${quantity}, ${mode}, ${item.name}, ${item.weight_grams}, ${position})`;
    void reply.status(201).send(await listAnswer(db, id));
  });

  app.patch('/api/lists/:id/lines/:lineId', async (request) => {
    guardCrossSite(request);
    await requireSession(request);
    requireJson(request);
    const { id, lineId } = request.params as { id: string; lineId: string };
    const body = await readJson(request);
    const unknown: Record<string, string> = {};
    for (const key of Object.keys(body)) {
      if (key !== 'quantity' && key !== 'mode') unknown[key] = "This field can't be set.";
    }
    if (Object.keys(unknown).length > 0) throw validationFailed(unknown);
    const list = await listById(id);
    if (list.state !== 'planning') throw listNotEditable(list.name, list.state);
    const line = await lineById(db, id, lineId);
    const item = await itemById(line.item_id);
    if ('quantity' in body) {
      const value = body['quantity'];
      if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) throw validationFailed({ quantity: 'Quantity must be at least 1.' });
      if (value > item.units_owned) throw validationFailed({ quantity: `You own ${item.units_owned}.` });
      await db`UPDATE lines SET quantity = ${value} WHERE id = ${lineId}`;
    }
    if ('mode' in body) {
      const value = body['mode'];
      if (value !== 'base' && value !== 'worn' && value !== 'consumable') throw validationFailed({ mode: 'Choose base, worn or consumable.' });
      await db`UPDATE lines SET mode = ${value} WHERE id = ${lineId}`;
    }
    return await listAnswer(db, id);
  });

  app.delete('/api/lists/:id/lines/:lineId', async (request) => {
    guardCrossSite(request);
    await requireSession(request);
    const { id, lineId } = request.params as { id: string; lineId: string };
    const list = await listById(id);
    if (list.state !== 'planning') throw listNotEditable(list.name, list.state);
    await lineById(db, id, lineId);
    await db`DELETE FROM lines WHERE id = ${lineId}`;
    return await listAnswer(db, id);
  });

  // ---- List state changes, with freezing.

  app.post('/api/lists/:id/state', async (request) => {
    guardCrossSite(request);
    await requireSession(request);
    requireJson(request);
    const { id } = request.params as { id: string };
    const body = await readJson(request);
    const unknown: Record<string, string> = {};
    for (const key of Object.keys(body)) {
      if (key !== 'to') unknown[key] = "This field can't be set.";
    }
    if (Object.keys(unknown).length > 0) throw validationFailed(unknown);
    const to = body['to'];
    if (to !== 'planning' && to !== 'packed' && to !== 'walked') {
      throw validationFailed({ to: 'Choose planning, packed or walked.' });
    }
    const applied = await db.begin(async (tx) => {
      const rows = await tx`SELECT id, name, state FROM lists WHERE id = ${id} FOR UPDATE`;
      const list = rows[0] as { id: string; name: string; state: ListState } | undefined;
      if (list === undefined) return { kind: 'not_found' as const };
      const lines = await tx`SELECT id, item_id, quantity, mode, name, unit_weight_grams FROM lines WHERE list_id = ${id}`;
      const stock = await tx`SELECT id, units_owned FROM closet_items`;
      const owned = new Map(stock.map((row) => [row.id as string, Number(row.units_owned)]));
      const hasLines = lines.length > 0;
      const allInCloset = lines.every((row) => (row.quantity as number) <= (owned.get(row.item_id as string) ?? 0));
      const result = checkListStateMove(list.state, to, { hasLines, allLinesInCloset: allInCloset });
      if (!result.ok) return { kind: 'refused' as const, code: result.code!, message: result.message! };
      // Planning → packed freezes each line's name and weight from one read of
      // the items; packed → planning takes the closet values again.
      if (list.state === 'planning' && to === 'packed') {
        const items = await tx`SELECT id, name, weight_grams FROM closet_items`;
        const byId = new Map(items.map((row) => [row.id as string, row]));
        for (const row of lines) {
          const item = byId.get(row.item_id as string);
          await tx`UPDATE lines SET name = ${item?.name ?? (row.name as string)}, unit_weight_grams = ${item?.weight_grams ?? (row.unit_weight_grams as number)} WHERE id = ${row.id}`;
        }
      } else if (list.state === 'packed' && to === 'planning') {
        const items = await tx`SELECT id, name, weight_grams FROM closet_items`;
        const byId = new Map(items.map((row) => [row.id as string, row]));
        for (const row of lines) {
          const item = byId.get(row.item_id as string);
          await tx`UPDATE lines SET name = ${item?.name ?? (row.name as string)}, unit_weight_grams = ${item?.weight_grams ?? (row.unit_weight_grams as number)} WHERE id = ${row.id}`;
        }
      }
      await tx`UPDATE lists SET state = ${to} WHERE id = ${id}`;
      return { kind: 'ok' as const };
    });
    if (applied.kind === 'not_found') throw listNotFound();
    if (applied.kind === 'refused') {
      if (applied.code === 'illegal_transition') {
        const list = await listById(id);
        throw illegalTransition(list.state, to);
      }
      if (applied.code === 'empty_list') throw emptyList();
      throw linesNotInCloset();
    }
    return await listAnswer(db, id);
  });

  // ---- Sync: replay of the offline queue, one op per transaction.

  app.post('/api/sync', async (request) => {
    guardCrossSite(request);
    await requireSession(request);
    requireJson(request);
    const body = await readJson(request);
    const unknown: Record<string, string> = {};
    for (const key of Object.keys(body)) {
      if (key !== 'ops') unknown[key] = "This field can't be set.";
    }
    if (Object.keys(unknown).length > 0) throw validationFailed(unknown);
    const ops = body['ops'];
    if (!Array.isArray(ops) || ops.length < 1 || ops.length > 200) throw validationFailed({ ops: 'Send 1 to 200 changes.' });
    const profile = await hiker();
    const results: { opId: string | null; result: 'applied' | 'refused'; reason: string | null }[] = [];
    for (const op of ops) {
      results.push(await applySyncOp(db, op));
    }
    const namedLists = [
      ...new Set(
        ops
          .filter((op): op is Record<string, unknown> => typeof op === 'object' && op !== null)
          .map((op) => op['listId'])
          .filter((value): value is string => typeof value === 'string'),
      ),
    ];
    const stock = await readItemsById(db);
    const stockMap = new Map([...stock.values()].map((row) => [row.id, itemStock(row)]));
    const summaries = [];
    for (const listId of namedLists) {
      const list = await readList(db, listId);
      if (list === null) continue;
      const lines = await readLines(db, listId);
      const lineLikes = lines.map((row) => lineFromRow(row, list.state, stock));
      const derived = deriveList(lineLikes, list.state, stockMap, profile.goalGrams, profile.unit);
      summaries.push({ id: list.id, name: list.name, state: list.state, totals: derived.totals });
    }
    return { results, lists: summaries };
  });

  // ---- Share links.

  app.get('/api/lists/:id/share', async (request) => {
    await requireSession(request);
    const { id } = request.params as { id: string };
    await listById(id);
    const profile = await hiker();
    const rows = await db`SELECT id, token, expires_on, created_at FROM shares WHERE list_id = ${id} ORDER BY created_at DESC`;
    const row = rows[0];
    if (row === undefined) return { share: null };
    const expired = shareExpired(row.expires_on === null ? null : isoDate(row.expires_on as Date), new Date(), profile.timeZone);
    return { share: { id: row.id, token: row.token, url: `/s/${row.token}`, expiresOn: row.expires_on === null ? null : isoDate(row.expires_on as Date), expired, createdAt: (row.created_at as Date).toISOString() } };
  });

  app.post('/api/lists/:id/share', async (request, reply) => {
    guardCrossSite(request);
    await requireSession(request);
    requireJson(request);
    const { id } = request.params as { id: string };
    await listById(id);
    const body = await readJson(request);
    const unknown: Record<string, string> = {};
    for (const key of Object.keys(body)) {
      if (key !== 'expiresOn') unknown[key] = "This field can't be set.";
    }
    if (Object.keys(unknown).length > 0) throw validationFailed(unknown);
    const profile = await hiker();
    let expiresOn: string | null = null;
    if (body['expiresOn'] !== undefined && body['expiresOn'] !== null) {
      const value = body['expiresOn'];
      if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw validationFailed({ expiresOn: 'Choose today or a later date.' });
      const today = todayInZone(profile.timeZone, new Date());
      if (value < today) throw validationFailed({ expiresOn: 'Choose today or a later date.' });
      expiresOn = value;
    }
    const shareId = newId();
    const token = newShareToken();
    await db.begin(async (tx) => {
      await tx`DELETE FROM shares WHERE list_id = ${id}`;
      await tx`INSERT INTO shares (id, list_id, token, expires_on) VALUES (${shareId}, ${id}, ${token}, ${expiresOn === null ? null : expiresOn})`;
    });
    void reply.status(201).send({ share: { id: shareId, token, url: `/s/${token}`, expiresOn, expired: false, createdAt: new Date().toISOString() } });
  });

  app.delete('/api/lists/:id/share', async (request, reply) => {
    guardCrossSite(request);
    await requireSession(request);
    const { id } = request.params as { id: string };
    await listById(id);
    await db`DELETE FROM shares WHERE list_id = ${id}`;
    void reply.status(204).send();
  });

  app.get('/api/share/:token', async (request, reply) => {
    const { token } = request.params as { token: string };
    const profile = await hiker();
    const rows = await db`SELECT id, list_id, expires_on, created_at FROM shares WHERE token = ${token}`;
    const row = rows[0];
    if (row === undefined) throw shareNotFound();
    const expires = row.expires_on === null ? null : isoDate(row.expires_on as Date);
    if (shareExpired(expires, new Date(), profile.timeZone)) throw shareNotFound();
    const list = await listById(row.list_id as string);
    const [lines, stock] = await Promise.all([readLines(db, list.id), readItemsById(db)]);
    const derived = deriveForList(list, lines, stock, profile.goalGrams, profile.unit);
    void reply
      .status(200)
      .header('Cache-Control', 'no-store')
      .send({
        share: {
          listName: list.name,
          state: list.state,
          hikerName: profile.displayName,
          lines: derived.lines
            .filter((line) => line.inCloset)
            .map((line) => ({ name: line.name, category: line.category, quantity: line.quantity, mode: line.mode, unitWeightGrams: line.unitWeightGrams, lineWeightGrams: line.lineWeightGrams, baseGrams: line.baseGrams, wornGrams: line.wornGrams, consumableGrams: line.consumableGrams, carryNote: line.carryNote, weightDisplay: line.weightDisplay })),
          categories: derived.categories.map((entry) => ({ category: entry.category, subtotalGrams: entry.subtotalGrams, baseGrams: entry.baseGrams, subtotalDisplay: entry.subtotalDisplay, baseDisplay: entry.baseDisplay })),
          totals: derived.totals,
        },
      });
  });

  for (const method of ['post', 'put', 'patch', 'delete'] as const) {
    app[method]('/api/share/:token', async (request, reply) => {
      void reply.status(405).header('Allow', 'GET').send(readOnly().body());
    });
  }

  // ---- Pack sheets.

  app.post('/api/lists/:id/pack-sheets', async (request, reply) => {
    guardCrossSite(request);
    await requireSession(request);
    const { id } = request.params as { id: string };
    const list = await listById(id);
    const profile = await hiker();
    const [lines, stock] = await Promise.all([readLines(db, id), readItemsById(db)]);
    const content = currentContent(list, lines, stock, profile);
    const html = packSheetHtml(list, lines, stock, profile);
    let pdf: Uint8Array;
    try {
      pdf = await renderPdf(config.gotenbergUrl, html, profile.paperSize);
    } catch {
      throw printingUnavailable();
    }
    const sheetId = newId();
    const key = `pack-sheets/${id}/${sheetId}.pdf`;
    try {
      await storage.put(key, pdf, 'application/pdf');
    } catch {
      throw storageUnavailable();
    }
    await db`INSERT INTO pack_sheets (id, list_id, paper_size, content_key, bytes) VALUES (${sheetId}, ${id}, ${profile.paperSize}, ${sheetContentKey(content)}, ${pdf.length})`;
    void reply.status(201).send({ sheet: sheetJson({ id: sheetId, list_id: id, paper_size: profile.paperSize, content_key: sheetContentKey(content), bytes: pdf.length, created_at: new Date() }, true, id) });
  });

  app.get('/api/lists/:id/pack-sheets', async (request) => {
    await requireSession(request);
    const { id } = request.params as { id: string };
    const list = await listById(id);
    const profile = await hiker();
    const [sheets, lines, stock] = await Promise.all([readSheets(db, id), readLines(db, id), readItemsById(db)]);
    const content = currentContent(list, lines, stock, profile);
    return { sheets: sheets.map((row) => sheetJson(row, isCurrent(content, row.content_key), id)) };
  });

  app.get('/api/pack-sheets/:sheetId/pdf', async (request, reply) => {
    await requireSession(request);
    const { sheetId } = request.params as { sheetId: string };
    const rows = await db`SELECT id, list_id FROM pack_sheets WHERE id = ${sheetId}`;
    const row = rows[0];
    if (row === undefined) throw notFound('sheet');
    let bytes: Uint8Array;
    try {
      bytes = await storage.get(`pack-sheets/${row.list_id}/${sheetId}.pdf`);
    } catch {
      throw storageUnavailable();
    }
    void reply.status(200).header('Content-Type', 'application/pdf').header('Content-Disposition', `attachment; filename="pack-sheet.pdf"`).send(Buffer.from(bytes));
  });

  // ---- Imports.

  app.post('/api/imports', async (request, reply) => {
    guardCrossSite(request);
    await requireSession(request);
    const file = await request.file();
    if (file === undefined) throw validationFailed({ file: 'Choose a CSV file.' });
    const bytes = await readStream(file.file);
    if (bytes.length === 0) throw validationFailed({ file: 'Choose a CSV file.' });
    if (bytes.length > CSV_LIMIT) throw payloadTooLarge();
    // The original bytes are stored and confirmed before any content check.
    const importId = newId();
    try {
      await storage.put(`imports/${importId}/original.csv`, bytes, 'text/csv');
    } catch {
      throw storageUnavailable();
    }
    const filename = file.filename ?? 'import.csv';
    try {
      const parsed = readImportFile(bytes);
      const rowsOut: { row: number; name: string; category: string; outcome: string; itemId: string | null; sameAsRow: number | null; reason: string | null }[] = [];
      let matched = 0;
      let created = 0;
      let rejected = 0;
      const identities = new Map<string, { row: number; itemId: string }>();
      const items = await readItems(db);
      const byIdentity = new Map(items.map((row) => [`${normaliseName(row.name)}\u0000${row.category}`, row]));
      for (const row of parsed.rows) {
        if (row.reason !== null) {
          rejected += 1;
          rowsOut.push({ row: row.row, name: row.name, category: row.category, outcome: 'rejected', itemId: null, sameAsRow: null, reason: row.reason });
          continue;
        }
        const identity = `${normaliseName(row.name)}\u0000${row.categoryCanonical}`;
        const earlier = identities.get(identity);
        const existing = byIdentity.get(identity);
        if (existing !== undefined || earlier !== undefined) {
          matched += 1;
          rowsOut.push({ row: row.row, name: row.name, category: row.categoryCanonical ?? row.category, outcome: 'matched', itemId: existing?.id ?? null, sameAsRow: earlier?.row ?? null, reason: null });
          continue;
        }
        created += 1;
        const itemId = newId();
        identities.set(identity, { row: row.row, itemId });
        rowsOut.push({ row: row.row, name: row.name, category: row.categoryCanonical ?? row.category, outcome: 'created', itemId: null, sameAsRow: null, reason: null });
      }
      await db.begin(async (tx) => {
        await tx`INSERT INTO import_runs (id, filename, bytes, status, counts_matched, counts_created, counts_rejected) VALUES (${importId}, ${filename}, ${bytes.length}, 'previewed', ${matched}, ${created}, ${rejected})`;
        for (const row of rowsOut) {
          await tx`INSERT INTO import_rows (import_id, row, name, category, outcome, item_id, same_as_row, reason) VALUES (${importId}, ${row.row}, ${row.name}, ${row.category}, ${row.outcome}, ${row.itemId}, ${row.sameAsRow}, ${row.reason})`;
        }
      });
      void reply.status(201).send({ import: importJson({ id: importId, filename, bytes: bytes.length, status: 'previewed', counts: { matched, created, rejected }, rows: rowsOut, uploadedAt: new Date().toISOString() }) });
    } catch (error) {
      // A refused file deletes its stored object before answering and records
      // no import run.
      try {
        await storage.delete(`imports/${importId}/original.csv`);
      } catch {
        // storage already unreachable; nothing further to clean
      }
      if (error instanceof ImportFileError) throw validationFailed({ file: error.fieldMessage });
      throw error;
    }
  });

  app.get('/api/imports', async (request) => {
    await requireSession(request);
    const rows = await db`SELECT id, filename, bytes, status, counts_matched, counts_created, counts_rejected, uploaded_at FROM import_runs ORDER BY uploaded_at DESC, id DESC`;
    return {
      imports: rows.map((row) => ({
        id: row.id as string,
        filename: row.filename as string,
        bytes: Number(row.bytes),
        uploadedAt: (row.uploaded_at as Date).toISOString(),
        status: row.status as string,
        counts: { matched: Number(row.counts_matched), created: Number(row.counts_created), rejected: Number(row.counts_rejected) },
      })),
    };
  });

  app.get('/api/imports/:id', async (request) => {
    await requireSession(request);
    const { id } = request.params as { id: string };
    const run = await db`SELECT id, filename, bytes, status, counts_matched, counts_created, counts_rejected, uploaded_at FROM import_runs WHERE id = ${id}`;
    const row = run[0];
    if (row === undefined) throw notFound('import');
    const rows = await db`SELECT row, name, category, outcome, item_id, same_as_row, reason FROM import_rows WHERE import_id = ${id} ORDER BY row ASC`;
    return {
      import: importJson({
        id: row.id as string,
        filename: row.filename as string,
        bytes: Number(row.bytes),
        status: row.status as string,
        counts: { matched: Number(row.counts_matched), created: Number(row.counts_created), rejected: Number(row.counts_rejected) },
        rows: rows.map((r) => ({ row: Number(r.row), name: r.name as string, category: r.category as string, outcome: r.outcome as string, itemId: (r.item_id as string | null) ?? null, sameAsRow: r.same_as_row === null ? null : Number(r.same_as_row), reason: (r.reason as string | null) ?? null })),
        uploadedAt: (row.uploaded_at as Date).toISOString(),
      }),
    };
  });

  app.post('/api/imports/:id/commit', async (request) => {
    guardCrossSite(request);
    await requireSession(request);
    const { id } = request.params as { id: string };
    const run = await db`SELECT id, status FROM import_runs WHERE id = ${id}`;
    const row = run[0];
    if (row === undefined) throw notFound('import');
    // One commit wins; the rest answer 409.
    const claimed = await db`UPDATE import_runs SET status = 'committed' WHERE id = ${id} AND status = 'previewed' RETURNING id`;
    if (claimed.length === 0) throw importCommitted();
    await db.begin(async (tx) => {
      const rows = await tx`SELECT row, name, category, outcome FROM import_rows WHERE import_id = ${id} ORDER BY row ASC`;
      const items = await tx`SELECT id, name, category FROM closet_items`;
      const byIdentity = new Map(items.map((r) => [`${normaliseName(r.name as string)}\u0000${r.category as string}`, r]));
      const identities = new Map<string, { row: number; itemId: string }>();
      const itemByIdRow = new Map(items.map((r) => [r.id as string, r]));
      let matched = 0;
      let created = 0;
      let rejected = 0;
      const updatedRows: { row: number; outcome: string; itemId: string | null; sameAsRow: number | null }[] = [];
      const originals = await tx`SELECT row, name, category, outcome, item_id, same_as_row, reason FROM import_rows WHERE import_id = ${id} ORDER BY row ASC`;
      const parsedOnce = await parseImportRowsFor(storage, id);
      for (const r of originals) {
        const rowNumber = Number(r.row);
        const raw = parsedOnce.get(rowNumber);
        if (raw === undefined || raw.reason !== null) {
          rejected += 1;
          updatedRows.push({ row: rowNumber, outcome: 'rejected', itemId: null, sameAsRow: null });
          continue;
        }
        const identity = `${normaliseName(raw.name)}\u0000${raw.categoryCanonical}`;
        const existing = byIdentity.get(identity);
        const earlier = identities.get(identity);
        if (existing !== undefined) {
          matched += 1;
          updatedRows.push({ row: rowNumber, outcome: 'matched', itemId: existing.id as string, sameAsRow: earlier?.row ?? null });
          continue;
        }
        if (earlier !== undefined) {
          matched += 1;
          updatedRows.push({ row: rowNumber, outcome: 'matched', itemId: itemByIdRow.has(earlier.itemId) ? earlier.itemId : null, sameAsRow: earlier.row });
          continue;
        }
        created += 1;
        const itemId = newId();
        identities.set(identity, { row: rowNumber, itemId });
        await tx`INSERT INTO closet_items (id, name, category, weight_grams, units_owned, status, price_cents, notes, photo_id, version) VALUES (${itemId}, ${raw.name}, ${raw.categoryCanonical}, ${raw.grams}, ${raw.qty}, 'active', ${raw.priceCents}, ${raw.notes}, NULL, 1)`;
        updatedRows.push({ row: rowNumber, outcome: 'created', itemId, sameAsRow: null });
      }
      for (const updated of updatedRows) {
        await tx`UPDATE import_rows SET outcome = ${updated.outcome}, item_id = ${updated.itemId}, same_as_row = ${updated.sameAsRow} WHERE import_id = ${id} AND row = ${updated.row}`;
      }
      await tx`UPDATE import_runs SET counts_matched = ${matched}, counts_created = ${created}, counts_rejected = ${rejected} WHERE id = ${id}`;
    });
    const fresh = await db`SELECT id, filename, bytes, status, counts_matched, counts_created, counts_rejected, uploaded_at FROM import_runs WHERE id = ${id}`;
    const row2 = fresh[0]!;
    return {
      import: importJson({
        id: row2.id as string,
        filename: row2.filename as string,
        bytes: Number(row2.bytes),
        status: row2.status as string,
        counts: { matched: Number(row2.counts_matched), created: Number(row2.counts_created), rejected: Number(row2.counts_rejected) },
        rows: [],
        uploadedAt: (row2.uploaded_at as Date).toISOString(),
      }),
    };
  });

  app.get('/api/imports/:id/original', async (request, reply) => {
    await requireSession(request);
    const { id } = request.params as { id: string };
    const run = await db`SELECT id, filename FROM import_runs WHERE id = ${id}`;
    const row = run[0];
    if (row === undefined) throw notFound('import');
    let bytes: Uint8Array;
    try {
      bytes = await storage.get(`imports/${id}/original.csv`);
    } catch {
      throw storageUnavailable();
    }
    void reply
      .status(200)
      .header('Content-Type', 'text/csv')
      .header('Content-Disposition', `attachment; filename="${row.filename as string}"`)
      .send(Buffer.from(bytes));
  });

  // ---- Pages and assets. The server serves only built browser assets and
  // the routes in this brief; nothing else is reachable.

  const indexHtml = await readFile(join(PUBLIC_DIR, 'index.html'), 'utf8');

  const sendPage = (reply: FastifyReply, status = 200): void => {
    void reply.status(status).header('Content-Type', 'text/html; charset=utf-8').header('Cache-Control', 'no-store').send(indexHtml);
  };

  const ownerPage = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const token = readSessionToken(request);
    if (!(await sessionLive(db, token))) {
      void reply.redirect('/sign-in');
      return;
    }
    sendPage(reply);
  };

  app.get('/', async (request, reply) => {
    void reply.redirect('/trips');
  });
  // The sign-in screen stays public; the owner pages redirect without a session.
  app.get('/sign-in', async (request, reply) => {
    sendPage(reply);
  });
  for (const route of ['/trips', '/closet', '/imports', '/settings', '/lists/:id']) {
    app.get(route, ownerPage);
  }
  app.get('/s/:token', async (request, reply) => {
    const { token } = request.params as { token: string };
    const profile = await hiker();
    const rows = await db`SELECT list_id, expires_on FROM shares WHERE token = ${token}`;
    const row = rows[0];
    const expires = row === undefined || row.expires_on === null ? null : isoDate(row.expires_on as Date);
    if (row === undefined || shareExpired(expires, new Date(), profile.timeZone)) {
      sendPage(reply, 404);
      return;
    }
    sendPage(reply);
  });

  // The app shell's service worker, served from the app's own origin.
  app.get('/sw.js', async (_request, reply) => {
    try {
      const body = await readFile(join(PUBLIC_DIR, 'sw.js'));
      void reply.status(200).header('Content-Type', 'text/javascript; charset=utf-8').header('Cache-Control', 'no-cache').send(body);
    } catch {
      void reply.status(404).send('Not found');
    }
  });

  app.get('/assets/*', async (request, reply) => {
    const name = (request.params as { '*': string })['*'];
    const safe = path.normalize(name).replace(/^(\.\.[/\\])+/, '');
    const target = join(PUBLIC_DIR, 'assets', safe);
    if (!target.startsWith(join(PUBLIC_DIR, 'assets'))) {
      void reply.status(404).send('Not found');
      return;
    }
    try {
      const body = await readFile(target);
      const type = assetType(target);
      void reply.status(200).header('Content-Type', type).header('Cache-Control', 'public, max-age=86400').send(body);
    } catch {
      void reply.status(404).send('Not found');
    }
  });
}

// ---- Helpers used above, outside the registration closure.

function assetType(target: string): string {
  if (target.endsWith('.js')) return 'text/javascript; charset=utf-8';
  if (target.endsWith('.css')) return 'text/css; charset=utf-8';
  if (target.endsWith('.woff2')) return 'font/woff2';
  if (target.endsWith('.svg')) return 'image/svg+xml';
  if (target.endsWith('.png')) return 'image/png';
  return 'application/octet-stream';
}

const PUBLIC_DIR = path.join(process.cwd(), 'dist', 'public');

function join(base: string, ...parts: string[]): string {
  return path.join(base, ...parts);
}

function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (typeof value === 'object' && value !== null) {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortKeys((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

async function readStream(stream: AsyncIterable<Buffer>): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk as Buffer);
  }
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

async function photoExtension(db: Db, photoId: string): Promise<string> {
  const rows = await db`SELECT extension FROM photos WHERE id = ${photoId}`;
  return (rows[0]?.extension as string | undefined) ?? 'jpg';
}

async function nextPosition(db: Db, listId: string): Promise<number> {
  const rows = await db`SELECT COALESCE(MAX(position), 0) AS max FROM lines WHERE list_id = ${listId}`;
  return Number(rows[0]?.max ?? 0) + 1;
}

async function lineById(db: Db, listId: string, lineId: string): Promise<LineRow> {
  const rows = await db`SELECT id, list_id, item_id, quantity, mode, name, unit_weight_grams, position FROM lines WHERE id = ${lineId} AND list_id = ${listId}`;
  const row = rows[0] as unknown as LineRow | undefined;
  if (row === undefined) throw lineNotFound();
  return row;
}

function orderByCategory(rows: ItemRow[]): ItemRow[] {
  return [...rows].sort((a, b) => {
    const order = CATEGORIES.indexOf(a.category) - CATEGORIES.indexOf(b.category);
    return order !== 0 ? order : a.name.localeCompare(b.name);
  });
}

function importJson(run: { id: string; filename: string; bytes: number; status: string; counts: { matched: number; created: number; rejected: number }; rows: unknown[]; uploadedAt: string }) {
  return { id: run.id, filename: run.filename, bytes: run.bytes, uploadedAt: run.uploadedAt, status: run.status, counts: run.counts, rows: run.rows };
}

function goalDisplayText(profile: { goalGrams: number; unit: DisplayUnit }): string {
  return formatWeight(profile.goalGrams, profile.unit);
}

/** camelCase profile keys map to their snake_case columns. */
function snakeCase(key: string): string {
  return key.replace(/[A-Z]/g, (char) => '_' + char.toLowerCase());
}

/**
 * Re-reads the stored original file and re-parses its rows for a commit, so
 * the commit's matching runs against the rows as parsed, not the preview.
 */
async function parseImportRowsFor(storage: Storage, importId: string): Promise<Map<number, { row: number; name: string; categoryCanonical: Category; grams: number; qty: number; priceCents: number | null; notes: string; reason: string | null }>> {
  const bytes = await storage.get(`imports/${importId}/original.csv`);
  const parsed = readImportFile(bytes);
  const out = new Map<number, { row: number; name: string; categoryCanonical: Category; grams: number; qty: number; priceCents: number | null; notes: string; reason: string | null }>();
  for (const row of parsed.rows) {
    out.set(row.row, {
      row: row.row,
      name: row.name,
      categoryCanonical: row.categoryCanonical ?? ('Essentials' as Category),
      grams: row.grams ?? 0,
      qty: row.qty ?? 1,
      priceCents: row.priceCents,
      notes: row.notes ?? '',
      reason: row.reason,
    });
  }
  return out;
}
