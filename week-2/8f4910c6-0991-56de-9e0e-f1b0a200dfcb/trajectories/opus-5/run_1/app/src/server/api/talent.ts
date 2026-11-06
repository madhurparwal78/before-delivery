import { query, queryOne, transaction } from '../db.js';
import { conflict, notFound, staleVersion, validation } from '../http/errors.js';
import type { Ctx, Reply, Route } from '../http/router.js';
import { STAFF_ROLES, type MemberRow } from '../data/members.js';
import {
  ERASED_NAME,
  bumpTalentVersion,
  findTalentById,
  insertTalent,
  listTalent,
  photosOf,
  photoUrl,
  talentView,
  type TalentRow,
} from '../data/talent.js';
import { normalisePhoto } from '../services/images.js';
import { deleteObject, putObject } from '../services/storage.js';
import { inchesToCm, roundHalfUp } from '../../shared/format.js';
import { parseHeightValue } from '../domain/roster.js';
import { toIsoInstant } from '../../shared/zone.js';
import { FieldErrors, cleanSingleLine, fieldCopy, json, readArray, readNumber, readRecord, readString } from './helpers.js';
import { newId } from '../ids.js';
import { BOARDS, OFFICES, type Board, type OfficeId, type TalentState } from '../../shared/types.js';

const PORTFOLIO_PHOTO_LIMIT_BYTES = 12_000_000;

type MeasurementKey = 'height' | 'chest' | 'waist' | 'hips';

const MEASUREMENT_COLUMNS: Record<MeasurementKey, string> = {
  height: 'height_cm',
  chest: 'chest_cm',
  waist: 'waist_cm',
  hips: 'hips_cm',
};

const MEASUREMENT_LABELS: Record<MeasurementKey, string> = {
  height: 'Height',
  chest: 'Chest',
  waist: 'Waist',
  hips: 'Hips',
};

/** Measurements arrive in either unit and are stored in whole centimetres. */
function readMeasurement(
  fields: FieldErrors,
  key: MeasurementKey,
  raw: Record<string, unknown>,
): number | undefined {
  const entry = readRecord(raw, key);
  if (!entry) return undefined;
  const unit = readString(entry, 'unit') ?? 'cm';
  const value = entry.value;
  if (unit === 'cm') {
    const centimetres = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(centimetres)) {
      fields.add(key, fieldCopy.wholeNumber(MEASUREMENT_LABELS[key]));
      return undefined;
    }
    return roundHalfUp(centimetres);
  }
  if (unit === 'in') {
    const inches = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(inches)) {
      fields.add(key, fieldCopy.wholeNumber(MEASUREMENT_LABELS[key]));
      return undefined;
    }
    return inchesToCm(inches);
  }
  if (unit === 'ft_in') {
    const parsed = typeof value === 'number' ? inchesToCm(value) : parseHeightValue(String(value));
    if (parsed === null) {
      fields.add(key, fieldCopy.wholeNumber(MEASUREMENT_LABELS[key]));
      return undefined;
    }
    return parsed;
  }
  fields.add(key, fieldCopy.wholeNumber(MEASUREMENT_LABELS[key]));
  return undefined;
}

async function talentReply(row: TalentRow, withOfficeNote: boolean): Promise<Reply> {
  return json(200, talentView(row, await photosOf(row.id), withOfficeNote));
}

async function requireTalent(id: string): Promise<TalentRow> {
  const row = await findTalentById(id);
  if (!row) throw notFound();
  return row;
}

async function bumpPortfolio(talentId: string, savedBy: string, nowMs: number): Promise<number> {
  const rows = await query<{ portfolio_version: number }>(
    `UPDATE talent SET portfolio_version = portfolio_version + 1, portfolio_saved_by = $2, portfolio_saved_at = $3
     WHERE id = $1 RETURNING portfolio_version`,
    [talentId, savedBy, new Date(nowMs)],
  );
  return rows[0].portfolio_version;
}

export const talentRoutes: Route[] = [
  {
    method: 'GET',
    path: '/api/talent',
    auth: 'session',
    roles: STAFF_ROLES,
    handler: async (ctx: Ctx): Promise<Reply> => {
      const office = ctx.url.searchParams.get('office');
      const state = ctx.url.searchParams.get('state');
      const errors: Record<string, string> = {};
      if (office && !OFFICES.includes(office as OfficeId)) errors.office = 'Choose one of the published offices.';
      if (state && !['active', 'withdrawn', 'erased'].includes(state)) {
        errors.state = 'Choose one of the published states.';
      }
      if (Object.keys(errors).length > 0) throw validation(errors);
      const rows = await listTalent({
        ...(office ? { office: office as OfficeId } : {}),
        ...(state ? { state: state as TalentState } : {}),
      });
      const views = [];
      for (const row of rows) views.push(talentView(row, await photosOf(row.id), true));
      return json(200, { talent: views });
    },
  },
  {
    method: 'GET',
    path: '/api/talent/:id',
    auth: 'session',
    handler: async (ctx: Ctx): Promise<Reply> => {
      const member = ctx.member as MemberRow;
      const row = await requireTalent(ctx.params.id);
      if (member.role === 'talent') {
        if (member.talent_id !== row.id) throw notFound();
        return talentReply(row, false);
      }
      return talentReply(row, true);
    },
  },
  {
    method: 'POST',
    path: '/api/talent',
    auth: 'session',
    roles: ['agency_director'],
    body: 'json',
    handler: async (ctx: Ctx): Promise<Reply> => {
      const fields = new FieldErrors();
      const displayName = cleanSingleLine(readString(ctx.json, 'displayName') ?? '');
      const office = readString(ctx.json, 'office') ?? '';
      const board = readString(ctx.json, 'board') ?? '';
      const email = cleanSingleLine(readString(ctx.json, 'email') ?? '');
      if (!displayName) fields.add('displayName', fieldCopy.required('Display name'));
      if (!OFFICES.includes(office as OfficeId)) fields.add('office', fieldCopy.required('Office'));
      if (!BOARDS.includes(board as Board)) fields.add('board', fieldCopy.required('Board'));
      if (email) {
        const clash = await queryOne<{ id: string }>(
          `SELECT id FROM talent WHERE lower(email) = lower($1) AND state <> 'erased'`,
          [email],
        );
        if (clash) fields.add('email', 'Another talent already uses that email address.');
      }
      const measurements = readRecord(ctx.json, 'measurements') ?? {};
      const heightCm = readMeasurement(fields, 'height', measurements);
      const chestCm = readMeasurement(fields, 'chest', measurements);
      const waistCm = readMeasurement(fields, 'waist', measurements);
      const hipsCm = readMeasurement(fields, 'hips', measurements);
      fields.throwIfAny();

      const row = await insertTalent({
        displayName,
        office: office as OfficeId,
        board: board as Board,
        email: email || null,
        dateOfBirth: readString(ctx.json, 'dateOfBirth'),
        phone: readString(ctx.json, 'phone'),
        heightCm: heightCm ?? null,
        chestCm: chestCm ?? null,
        waistCm: waistCm ?? null,
        hipsCm: hipsCm ?? null,
      });
      return json(201, talentView(row, [], true));
    },
  },
  {
    method: 'PATCH',
    path: '/api/talent/:id',
    auth: 'session',
    roles: ['booker', 'agency_director'],
    body: 'json',
    load: async (ctx: Ctx): Promise<void> => {
      await requireTalent(ctx.params.id);
    },
    handler: async (ctx: Ctx): Promise<Reply> => {
      const member = ctx.member as MemberRow;
      const row = await requireTalent(ctx.params.id);
      const version = readNumber(ctx.json, 'version');
      if (version !== null && version !== row.version) {
        throw staleVersion(
          row.saved_by ?? member.name,
          toIsoInstant((row.saved_at ?? new Date(ctx.nowMs)).getTime()),
        );
      }
      const fields = new FieldErrors();
      const updates: Array<{ column: string; value: unknown }> = [];
      const displayName = readString(ctx.json, 'displayName');
      if (displayName !== null) {
        const clean = cleanSingleLine(displayName);
        if (!clean) fields.add('displayName', fieldCopy.required('Display name'));
        else updates.push({ column: 'display_name', value: clean });
      }
      const measurements = readRecord(ctx.json, 'measurements');
      if (measurements) {
        for (const key of ['height', 'chest', 'waist', 'hips'] as MeasurementKey[]) {
          const value = readMeasurement(fields, key, measurements);
          if (value !== undefined) updates.push({ column: MEASUREMENT_COLUMNS[key], value });
        }
      }
      const reach = readRecord(ctx.json, 'reach');
      if (reach) {
        for (const [key, column] of [
          ['instagram', 'instagram'],
          ['tiktok', 'tiktok'],
          ['youtube', 'youtube'],
        ] as const) {
          if (!(key in reach)) continue;
          const value = readNumber(reach, key);
          if (value === null || !Number.isInteger(value) || value < 0) {
            fields.add(key, fieldCopy.wholeNumber(key === 'instagram' ? 'Instagram followers' : key === 'tiktok' ? 'TikTok followers' : 'YouTube subscribers'));
            continue;
          }
          updates.push({ column, value });
        }
      }
      const officeNote = readString(ctx.json, 'officeNote');
      if (officeNote !== null) updates.push({ column: 'office_note', value: officeNote });
      fields.throwIfAny();

      if (updates.length > 0) {
        const assignments = updates.map((update, index) => `${update.column} = $${index + 2}`).join(', ');
        await query(`UPDATE talent SET ${assignments} WHERE id = $1`, [
          row.id,
          ...updates.map((update) => update.value),
        ]);
      }
      const updated = await bumpTalentVersion(row.id, member.name, ctx.nowMs);
      return talentReply(updated, true);
    },
  },
  {
    method: 'POST',
    path: '/api/talent/:id/photos',
    auth: 'session',
    roles: ['booker', 'agency_director'],
    body: 'multipart',
    fileLimitBytes: PORTFOLIO_PHOTO_LIMIT_BYTES,
    load: async (ctx: Ctx): Promise<void> => {
      await requireTalent(ctx.params.id);
    },
    handler: async (ctx: Ctx): Promise<Reply> => {
      const member = ctx.member as MemberRow;
      const row = await requireTalent(ctx.params.id);
      if (!ctx.file) throw validation({ file: fieldCopy.notAnImage() });
      const photo = await normalisePhoto(ctx.file.bytes);
      if (!photo) throw validation({ file: fieldCopy.notAnImage() });

      const photoId = newId('pho');
      const objectKey = `portfolio/${row.id}/${photoId}.jpg`;
      await putObject(objectKey, photo.jpeg, 'image/jpeg');
      try {
        const position = await queryOne<{ next: number }>(
          'SELECT coalesce(max(position), -1) + 1 AS next FROM photos WHERE talent_id = $1',
          [row.id],
        );
        await query(
          `INSERT INTO photos (id, talent_id, position, object_key, width, height, bytes)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [photoId, row.id, position?.next ?? 0, objectKey, photo.width, photo.height, photo.jpeg.length],
        );
      } catch (error) {
        await deleteObject(objectKey);
        throw error;
      }
      const portfolioVersion = await bumpPortfolio(row.id, member.name, ctx.nowMs);
      return json(201, {
        photoId,
        url: photoUrl(photoId),
        width: photo.width,
        height: photo.height,
        portfolioVersion,
      });
    },
  },
  {
    method: 'DELETE',
    path: '/api/talent/:id/photos/:photoId',
    auth: 'session',
    roles: ['booker', 'agency_director'],
    load: async (ctx: Ctx): Promise<void> => {
      await requireTalent(ctx.params.id);
    },
    handler: async (ctx: Ctx): Promise<Reply> => {
      const member = ctx.member as MemberRow;
      const row = await requireTalent(ctx.params.id);
      const photo = await queryOne<{ id: string; object_key: string }>(
        'SELECT id, object_key FROM photos WHERE id = $1 AND talent_id = $2',
        [ctx.params.photoId, row.id],
      );
      if (!photo) throw notFound();
      await deleteObject(photo.object_key);
      await query('DELETE FROM photos WHERE id = $1', [photo.id]);
      const remaining = await photosOf(row.id);
      for (const [index, entry] of remaining.entries()) {
        await query('UPDATE photos SET position = $2 WHERE id = $1', [entry.id, index]);
      }
      await bumpPortfolio(row.id, member.name, ctx.nowMs);
      return { status: 204 };
    },
  },
  {
    method: 'PUT',
    path: '/api/talent/:id/photos/order',
    auth: 'session',
    roles: ['booker', 'agency_director'],
    body: 'json',
    load: async (ctx: Ctx): Promise<void> => {
      await requireTalent(ctx.params.id);
    },
    handler: async (ctx: Ctx): Promise<Reply> => {
      const member = ctx.member as MemberRow;
      const row = await requireTalent(ctx.params.id);
      const portfolioVersion = readNumber(ctx.json, 'portfolioVersion');
      if (portfolioVersion !== null && portfolioVersion !== row.portfolio_version) {
        throw staleVersion(
          row.portfolio_saved_by ?? member.name,
          toIsoInstant((row.portfolio_saved_at ?? new Date(ctx.nowMs)).getTime()),
        );
      }
      const photoIds = (readArray(ctx.json, 'photoIds') ?? []).map((value) => String(value));
      const current = await photosOf(row.id);
      const sameSet =
        photoIds.length === current.length
        && new Set(photoIds).size === photoIds.length
        && photoIds.every((id) => current.some((photo) => photo.id === id));
      if (!sameSet) throw validation({ photoIds: 'List every photo of this portfolio exactly once.' });

      await transaction(async (tx) => {
        for (const [index, id] of photoIds.entries()) {
          await tx.query('UPDATE photos SET position = $2 WHERE id = $1', [id, index]);
        }
      });
      const newVersion = await bumpPortfolio(row.id, member.name, ctx.nowMs);
      return json(200, { portfolioVersion: newVersion, photoIds });
    },
  },
  {
    method: 'POST',
    path: '/api/talent/:id/withdraw',
    auth: 'session',
    roles: ['agency_director'],
    body: 'json',
    load: async (ctx: Ctx): Promise<void> => {
      await requireTalent(ctx.params.id);
    },
    handler: async (ctx: Ctx): Promise<Reply> => {
      const row = await requireTalent(ctx.params.id);
      if (row.state === 'erased') throw conflict('erased');
      if (row.state === 'withdrawn') throw conflict('already_withdrawn');
      const updated = await query<TalentRow>(
        `UPDATE talent SET state = 'withdrawn' WHERE id = $1 RETURNING *`,
        [row.id],
      );
      return talentReply(updated[0], true);
    },
  },
  {
    method: 'POST',
    path: '/api/talent/:id/restore',
    auth: 'session',
    roles: ['agency_director'],
    body: 'json',
    load: async (ctx: Ctx): Promise<void> => {
      await requireTalent(ctx.params.id);
    },
    handler: async (ctx: Ctx): Promise<Reply> => {
      const row = await requireTalent(ctx.params.id);
      if (row.state === 'erased') throw conflict('erased');
      if (row.state !== 'withdrawn') throw conflict('not_withdrawn');
      const updated = await query<TalentRow>(
        `UPDATE talent SET state = 'active' WHERE id = $1 RETURNING *`,
        [row.id],
      );
      return talentReply(updated[0], true);
    },
  },
  {
    method: 'POST',
    path: '/api/talent/:id/erase',
    auth: 'session',
    roles: ['agency_director'],
    body: 'json',
    load: async (ctx: Ctx): Promise<void> => {
      await requireTalent(ctx.params.id);
    },
    handler: async (ctx: Ctx): Promise<Reply> => {
      const row = await requireTalent(ctx.params.id);
      if (row.state === 'erased') throw conflict('erased');
      const photos = await photosOf(row.id);
      for (const photo of photos) await deleteObject(photo.object_key);

      await transaction(async (tx) => {
        await tx.query('DELETE FROM photos WHERE talent_id = $1', [row.id]);
        await tx.query('DELETE FROM package_talent WHERE talent_id = $1', [row.id]);
        await tx.query('DELETE FROM members WHERE talent_id = $1', [row.id]);
        await tx.query(
          `DELETE FROM outbox WHERE sent_at IS NULL AND ($1 = ANY(talent_ids) OR body LIKE $2 OR subject LIKE $2)`,
          [row.id, `%${row.display_name}%`],
        );
        await tx.query(
          `UPDATE talent SET state = 'erased', display_name = $2, email = NULL, phone = NULL,
                  home_address = NULL, date_of_birth = NULL, guardian_name = NULL, guardian_email = NULL,
                  guardian_phone = NULL, height_cm = NULL, chest_cm = NULL, waist_cm = NULL, hips_cm = NULL,
                  instagram = 0, tiktok = 0, youtube = 0, office_note = NULL, feed_token = NULL,
                  version = version + 1
           WHERE id = $1`,
          [row.id, ERASED_NAME],
        );
        await tx.query('UPDATE booking_talent SET display_name = $2 WHERE talent_id = $1', [
          row.id,
          ERASED_NAME,
        ]);
        await tx.query(
          'UPDATE booking_lines SET label = replace(label, $2, $3) WHERE talent_id = $1',
          [row.id, row.display_name, ERASED_NAME],
        );
      });
      const updated = await requireTalent(row.id);
      return talentReply(updated, true);
    },
  },
];
