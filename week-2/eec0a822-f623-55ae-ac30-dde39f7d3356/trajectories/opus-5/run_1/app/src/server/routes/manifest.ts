import { randomUUID } from 'node:crypto';
import { query, queryOne } from '../db.js';
import { conflict, notFound, pageEnded, storageUnavailable, tooLarge, validation } from '../http/errors.js';
import { filePart } from '../http/multipart.js';
import { readJsonBody, type Ctx, type Reply, type Router } from '../http/router.js';
import { FIELD_ERRORS } from '../../shared/copy.js';
import { COUNTRY_CODES } from '../../shared/countries.js';
import { pageStatus } from '../domain/pages.js';
import { isValidDateString, splitToday, toInstantString, addDays } from '../../shared/zone.js';
import { normalisePhoto } from '../services/images.js';
import { deleteObject, putObject, StorageUnreachable } from '../services/storage.js';
import { json, noContent } from './helpers.js';
import type { GuestRow, ManifestPageRow } from './charters.js';

export const PHOTO_LIMIT_BYTES = 5_000_000;

interface ManifestContext {
  readonly page: ManifestPageRow;
  readonly charterId: string;
  readonly yachtName: string;
  readonly weekStart: string;
  readonly weekEnd: string;
  readonly maxGuests: number;
}

async function requireLivePage(ctx: Ctx): Promise<ManifestContext> {
  const found = await queryOne<
    ManifestPageRow & {
      yacht_name: string;
      week_start: string;
      week_end: string;
      cabins: number;
      charter_status: string;
    }
  >(
    `SELECT p.*, y.name AS yacht_name, c.week_start, c.week_end, y.cabins, c.status AS charter_status
       FROM manifest_pages p
       JOIN charters c ON c.id = p.charter_id
       JOIN yachts y ON y.id = c.yacht_id
      WHERE p.token = $1`,
    [ctx.params.token],
  );
  if (found === null) throw notFound();
  if (pageStatus(found, ctx.now) !== 'live') throw pageEnded();
  return {
    page: found,
    charterId: found.charter_id,
    yachtName: found.yacht_name,
    weekStart: found.week_start,
    weekEnd: found.week_end,
    maxGuests: found.cabins * 2,
  };
}

function guestJson(guest: GuestRow): Record<string, unknown> {
  return {
    id: guest.id,
    fullName: guest.full_name,
    nationality: guest.nationality,
    passportOnFile: guest.passport_number !== null,
    dateOfBirthOnFile: guest.date_of_birth !== null,
    photoOnFile: guest.photo_key !== null,
  };
}

async function guestsOf(charterId: string): Promise<GuestRow[]> {
  return query<GuestRow>('SELECT * FROM guests WHERE charter_id = $1 ORDER BY seed_order', [
    charterId,
  ]);
}

async function readManifest(ctx: Ctx): Promise<Reply> {
  const manifest = await requireLivePage(ctx);
  return json(200, {
    yachtName: manifest.yachtName,
    weekStart: manifest.weekStart,
    weekEnd: manifest.weekEnd,
    maxGuests: manifest.maxGuests,
    status: 'live',
    endsAt: toInstantString(manifest.page.ends_at),
    guests: (await guestsOf(manifest.charterId)).map(guestJson),
  });
}

async function addGuest(ctx: Ctx): Promise<Reply> {
  const manifest = await requireLivePage(ctx);
  const body = readJsonBody(ctx);
  const guests = await guestsOf(manifest.charterId);
  if (guests.length >= manifest.maxGuests) {
    throw conflict('manifest_full', { maxGuests: manifest.maxGuests });
  }
  const fullName = typeof body.fullName === 'string' ? body.fullName.trim() : '';
  if (fullName === '') throw validation({ fullName: FIELD_ERRORS.required });
  if ([...fullName].length > 80) throw validation({ fullName: FIELD_ERRORS.maxLength(80) });
  const id = randomUUID();
  await query(
    'INSERT INTO guests (id, charter_id, full_name, seed_order) VALUES ($1,$2,$3,$4)',
    [id, manifest.charterId, fullName, guests.length],
  );
  const created = (await queryOne<GuestRow>('SELECT * FROM guests WHERE id = $1', [id])) as GuestRow;
  return json(201, { guest: guestJson(created) });
}

function readPassportNumber(
  errors: Record<string, string>,
  path: string,
  value: unknown,
  onFile: string | null,
): string | null {
  const given = typeof value === 'string' ? value.trim() : '';
  if (given === '') {
    if (onFile === null) errors[path] = FIELD_ERRORS.required;
    return onFile;
  }
  if (!/^[A-Z0-9]{5,20}$/.test(given)) {
    errors[path] = FIELD_ERRORS.passportNumber;
    return onFile;
  }
  return given;
}

function readDateOfBirth(
  errors: Record<string, string>,
  path: string,
  value: unknown,
  onFile: string | null,
  today: string,
): string | null {
  const given = typeof value === 'string' ? value.trim() : '';
  if (given === '') {
    if (onFile === null) errors[path] = FIELD_ERRORS.required;
    return onFile;
  }
  if (!isValidDateString(given) || given >= today || given < addDays(today, -365 * 120 - 30)) {
    errors[path] = FIELD_ERRORS.dateOfBirth;
    return onFile;
  }
  return given;
}

async function saveGuests(ctx: Ctx): Promise<Reply> {
  const manifest = await requireLivePage(ctx);
  const body = readJsonBody(ctx);
  const given = Array.isArray(body.guests) ? (body.guests as unknown[]) : [];
  const stored = await guestsOf(manifest.charterId);
  const byId = new Map(stored.map((guest) => [guest.id, guest]));
  const errors: Record<string, string> = {};
  const today = splitToday(ctx.now);
  const updates: {
    id: string;
    fullName: string;
    nationality: string;
    dateOfBirth: string | null;
    passportNumber: string | null;
  }[] = [];
  for (const [index, entry] of given.entries()) {
    const record = (entry ?? {}) as Record<string, unknown>;
    const id = typeof record.id === 'string' ? record.id : '';
    const existing = byId.get(id);
    if (existing === undefined) throw notFound();
    const fullName = typeof record.fullName === 'string' ? record.fullName.trim() : '';
    if (fullName === '') errors[`guests.${index}.fullName`] = FIELD_ERRORS.required;
    else if ([...fullName].length > 80) {
      errors[`guests.${index}.fullName`] = FIELD_ERRORS.maxLength(80);
    }
    const nationality = typeof record.nationality === 'string' ? record.nationality.trim() : '';
    if (nationality === '') errors[`guests.${index}.nationality`] = FIELD_ERRORS.required;
    else if (!COUNTRY_CODES.has(nationality)) {
      errors[`guests.${index}.nationality`] = FIELD_ERRORS.options;
    }
    const dateOfBirth = readDateOfBirth(
      errors,
      `guests.${index}.dateOfBirth`,
      record.dateOfBirth,
      existing.date_of_birth,
      today,
    );
    const passportNumber = readPassportNumber(
      errors,
      `guests.${index}.passportNumber`,
      record.passportNumber,
      existing.passport_number,
    );
    updates.push({ id, fullName, nationality, dateOfBirth, passportNumber });
  }
  if (Object.keys(errors).length > 0) throw validation(errors);
  for (const update of updates) {
    await query(
      `UPDATE guests SET full_name = $2, nationality = $3, date_of_birth = $4, passport_number = $5
        WHERE id = $1`,
      [update.id, update.fullName, update.nationality, update.dateOfBirth, update.passportNumber],
    );
  }
  return json(200, { guests: (await guestsOf(manifest.charterId)).map(guestJson) });
}

async function removeGuest(ctx: Ctx): Promise<Reply> {
  const manifest = await requireLivePage(ctx);
  const guest = await queryOne<GuestRow>('SELECT * FROM guests WHERE id = $1 AND charter_id = $2', [
    ctx.params.guestId,
    manifest.charterId,
  ]);
  if (guest === null) throw notFound();
  if (guest.photo_key !== null) {
    try {
      await deleteObject(guest.photo_key);
    } catch (error) {
      if (error instanceof StorageUnreachable) throw storageUnavailable();
      throw error;
    }
  }
  await query('DELETE FROM guests WHERE id = $1', [guest.id]);
  const remaining = await guestsOf(manifest.charterId);
  for (const [index, other] of remaining.entries()) {
    await query('UPDATE guests SET seed_order = $2 WHERE id = $1', [other.id, index]);
  }
  return noContent();
}

async function uploadPhoto(ctx: Ctx): Promise<Reply> {
  const manifest = await requireLivePage(ctx);
  const guest = await queryOne<GuestRow>('SELECT * FROM guests WHERE id = $1 AND charter_id = $2', [
    ctx.params.guestId,
    manifest.charterId,
  ]);
  if (guest === null) throw notFound();
  const part = filePart(ctx, 'photo');
  if (part === null) throw validation({ photo: FIELD_ERRORS.required });
  if (part.content.length > PHOTO_LIMIT_BYTES) throw tooLarge(PHOTO_LIMIT_BYTES);
  const image = normalisePhoto(part.content);
  if (image === null) throw validation({ photo: FIELD_ERRORS.photoContent });
  const key = `passport-photos/${manifest.charterId}/${guest.id}.${image.extension}`;
  try {
    await putObject(key, image.content, image.contentType);
  } catch (error) {
    if (error instanceof StorageUnreachable) throw storageUnavailable();
    throw error;
  }
  await query('UPDATE guests SET photo_key = $2, photo_content_type = $3 WHERE id = $1', [
    guest.id,
    key,
    image.contentType,
  ]);
  const updated = (await queryOne<GuestRow>('SELECT * FROM guests WHERE id = $1', [
    guest.id,
  ])) as GuestRow;
  return json(201, { guest: guestJson(updated) });
}

export function registerManifestRoutes(router: Router): void {
  router.add('/api/manifest/:token', { GET: readManifest });
  router.add('/api/manifest/:token/guests', { POST: addGuest, PUT: saveGuests });
  router.add('/api/manifest/:token/guests/:guestId', { DELETE: removeGuest });
  router.add(
    '/api/manifest/:token/guests/:guestId/photo',
    { POST: uploadPhoto },
    { fileLimitBytes: PHOTO_LIMIT_BYTES },
  );
}
