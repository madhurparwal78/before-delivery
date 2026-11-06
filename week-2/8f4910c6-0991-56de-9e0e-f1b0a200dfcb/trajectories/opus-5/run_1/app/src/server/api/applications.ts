import { config } from '../config.js';
import { query, queryOne, transaction } from '../db.js';
import { conflict, gone, notFound, validation } from '../http/errors.js';
import type { Ctx, Reply, Route } from '../http/router.js';
import type { MemberRow } from '../data/members.js';
import { insertTalent, type TalentRow } from '../data/talent.js';
import { loadOffice } from '../data/offices.js';
import { isMinorOn } from '../domain/age.js';
import { normalisePhoto } from '../services/images.js';
import { getObject, putObject } from '../services/storage.js';
import { guardianConsentEmail } from '../emails.js';
import { queueMail } from '../services/mail.js';
import { newId, newToken } from '../ids.js';
import { officeDate, parseIsoDate, toIsoInstant } from '../../shared/zone.js';
import {
  EMAIL_PATTERN,
  FieldErrors,
  cleanSingleLine,
  countGraphemes,
  fieldCopy,
  json,
  readNumber,
  readRecord,
  readString,
} from './helpers.js';
import {
  OFFICES,
  PHOTO_SLOTS,
  type ApplicationStatus,
  type OfficeId,
  type PhotoSlot,
} from '../../shared/types.js';

const APPLICATION_PHOTO_LIMIT_BYTES = 8_000_000;
export const BIO_LIMIT = 600;

type ApplicationRow = {
  id: string;
  token: string;
  status: ApplicationStatus;
  office_id: OfficeId;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  date_of_birth: string | null;
  height_cm: number | null;
  instagram_followers: number | null;
  bio: string | null;
  guardian_name: string | null;
  guardian_email: string | null;
  minor: boolean;
  consent_token: string | null;
  consent_expires_at: Date | null;
  consent_used_at: Date | null;
  consent_decision: string | null;
  submitted_at: Date | null;
  decision: string | null;
  decided_by: string | null;
  decided_by_name: string | null;
  decided_at: Date | null;
  talent_id: string | null;
};

async function photoSlots(applicationId: string): Promise<PhotoSlot[]> {
  const rows = await query<{ slot: PhotoSlot }>(
    'SELECT slot FROM application_photos WHERE application_id = $1',
    [applicationId],
  );
  return PHOTO_SLOTS.filter((slot) => rows.some((row) => row.slot === slot));
}

async function draftView(row: ApplicationRow): Promise<Record<string, unknown>> {
  return {
    id: row.id,
    status: row.status,
    office: row.office_id,
    firstName: row.first_name,
    lastName: row.last_name,
    email: row.email,
    dateOfBirth: row.date_of_birth,
    height: row.height_cm === null ? null : { value: row.height_cm, unit: 'cm' },
    instagramFollowers: row.instagram_followers,
    bio: row.bio,
    guardianName: row.guardian_name,
    guardianEmail: row.guardian_email,
    minor: row.minor,
    photos: await photoSlots(row.id),
  };
}

async function reviewView(row: ApplicationRow): Promise<Record<string, unknown>> {
  return {
    id: row.id,
    status: row.status,
    office: row.office_id,
    applicantName: `${row.first_name ?? ''} ${row.last_name ?? ''}`.trim(),
    firstName: row.first_name,
    email: row.email,
    dateOfBirth: row.date_of_birth,
    minor: row.minor,
    heightCm: row.height_cm,
    instagramFollowers: row.instagram_followers ?? 0,
    bio: row.bio,
    guardianName: row.guardian_name,
    guardianEmail: row.guardian_email,
    submittedAt: row.submitted_at ? toIsoInstant(row.submitted_at.getTime()) : null,
    decidedBy: row.decided_by_name,
    decidedAt: row.decided_at ? toIsoInstant(row.decided_at.getTime()) : null,
    photos: (await photoSlots(row.id)).map((slot) => ({
      slot,
      url: `/api/applications/${row.id}/photos/${slot}`,
    })),
    talentId: row.talent_id,
  };
}

/** The draft token stands in for a session on the public application form. */
async function applicationFromToken(ctx: Ctx): Promise<ApplicationRow> {
  const header = ctx.headers['x-application-token'];
  const token = Array.isArray(header) ? header[0] : header;
  const row = await queryOne<ApplicationRow>('SELECT * FROM applications WHERE id = $1', [ctx.params.id]);
  if (!row || !token || row.token !== token) throw notFound();
  return row;
}

async function recomputeMinor(row: ApplicationRow, nowMs: number): Promise<boolean> {
  if (!row.date_of_birth) return false;
  const dob = parseIsoDate(row.date_of_birth);
  if (!dob) return false;
  const office = await loadOffice(row.office_id);
  return isMinorOn(dob, officeDate(office.timeZone, nowMs));
}

export const applicationRoutes: Route[] = [
  {
    method: 'POST',
    path: '/api/applications',
    auth: 'public',
    body: 'json',
    limiter: { bucket: 'application_drafts', limit: 3, windowSeconds: 60 },
    handler: async (ctx: Ctx): Promise<Reply> => {
      const office = readString(ctx.json, 'office') ?? '';
      if (!OFFICES.includes(office as OfficeId)) throw validation({ office: fieldCopy.required('Office') });
      const id = newId('app');
      const token = newToken();
      await query(
        `INSERT INTO applications (id, token, status, office_id) VALUES ($1, $2, 'draft', $3)`,
        [id, token, office],
      );
      return json(201, { id, token, status: 'draft' });
    },
  },
  {
    method: 'GET',
    path: '/api/applications/:id',
    auth: 'public',
    handler: async (ctx: Ctx): Promise<Reply> => json(200, await draftView(await applicationFromToken(ctx))),
  },
  {
    method: 'PATCH',
    path: '/api/applications/:id',
    auth: 'public',
    body: 'json',
    handler: async (ctx: Ctx): Promise<Reply> => {
      const row = await applicationFromToken(ctx);
      if (row.status !== 'draft') throw conflict('already_submitted');
      const fields = new FieldErrors();
      const updates: Array<{ column: string; value: unknown }> = [];

      const text = (key: string, column: string, label: string): void => {
        const value = readString(ctx.json, key);
        if (value === null) return;
        const clean = cleanSingleLine(value);
        if (!clean) fields.add(key, fieldCopy.required(label));
        else updates.push({ column, value: clean });
      };
      text('firstName', 'first_name', 'First name');
      text('lastName', 'last_name', 'Last name');
      const email = readString(ctx.json, 'email');
      if (email !== null) {
        const clean = cleanSingleLine(email);
        if (!clean) fields.add('email', fieldCopy.required('Email'));
        else if (!EMAIL_PATTERN.test(clean)) fields.add('email', fieldCopy.email());
        else updates.push({ column: 'email', value: clean });
      }
      const dateOfBirth = readString(ctx.json, 'dateOfBirth');
      if (dateOfBirth !== null) {
        if (!parseIsoDate(dateOfBirth)) fields.add('dateOfBirth', fieldCopy.required('Date of birth'));
        else updates.push({ column: 'date_of_birth', value: dateOfBirth });
      }
      const office = readString(ctx.json, 'office');
      if (office !== null) {
        if (!OFFICES.includes(office as OfficeId)) fields.add('office', fieldCopy.required('Office'));
        else updates.push({ column: 'office_id', value: office });
      }
      const height = readRecord(ctx.json, 'height');
      if (height) {
        const value = readNumber(height, 'value');
        const unit = readString(height, 'unit') ?? 'cm';
        if (value === null || value <= 0) fields.add('height', fieldCopy.required('Height'));
        else updates.push({
          column: 'height_cm',
          value: unit === 'in' ? Math.round(value * 2.54) : Math.round(value),
        });
      }
      const followers = readNumber(ctx.json, 'instagramFollowers');
      if (followers !== null) {
        if (!Number.isInteger(followers) || followers < 0) {
          fields.add('instagramFollowers', fieldCopy.wholeNumber('Instagram followers'));
        } else {
          updates.push({ column: 'instagram_followers', value: followers });
        }
      }
      const bio = readString(ctx.json, 'bio');
      if (bio !== null) {
        const used = countGraphemes(bio);
        if (used > BIO_LIMIT) fields.add('bio', fieldCopy.bioOverLimit(used));
        else if (!bio.trim()) fields.add('bio', fieldCopy.required('Bio'));
        else updates.push({ column: 'bio', value: bio });
      }
      text('guardianName', 'guardian_name', 'Guardian name');
      const guardianEmail = readString(ctx.json, 'guardianEmail');
      if (guardianEmail !== null) {
        const clean = cleanSingleLine(guardianEmail);
        if (!clean) fields.add('guardianEmail', fieldCopy.required('Guardian email'));
        else if (!EMAIL_PATTERN.test(clean)) fields.add('guardianEmail', fieldCopy.email());
        else updates.push({ column: 'guardian_email', value: clean });
      }
      fields.throwIfAny();

      if (updates.length > 0) {
        const assignments = updates.map((update, index) => `${update.column} = $${index + 2}`).join(', ');
        await query(`UPDATE applications SET ${assignments} WHERE id = $1`, [
          row.id,
          ...updates.map((update) => update.value),
        ]);
      }
      const refreshed = await queryOne<ApplicationRow>('SELECT * FROM applications WHERE id = $1', [row.id]);
      if (!refreshed) throw notFound();
      const minor = await recomputeMinor(refreshed, ctx.nowMs);
      await query('UPDATE applications SET minor = $2 WHERE id = $1', [row.id, minor]);
      return json(200, await draftView({ ...refreshed, minor }));
    },
  },
  {
    method: 'PUT',
    path: '/api/applications/:id/photos/:slot',
    auth: 'public',
    body: 'multipart',
    fileLimitBytes: APPLICATION_PHOTO_LIMIT_BYTES,
    handler: async (ctx: Ctx): Promise<Reply> => {
      const row = await applicationFromToken(ctx);
      const slot = ctx.params.slot as PhotoSlot;
      if (!PHOTO_SLOTS.includes(slot)) throw notFound();
      if (row.status !== 'draft') throw conflict('already_submitted');
      if (!ctx.file) throw validation({ file: fieldCopy.notAnImage() });
      const photo = await normalisePhoto(ctx.file.bytes);
      if (!photo) throw validation({ file: fieldCopy.notAnImage() });
      const objectKey = `applications/${row.id}/${slot}.jpg`;
      await putObject(objectKey, photo.jpeg, 'image/jpeg');
      await query(
        `INSERT INTO application_photos (application_id, slot, object_key, width, height)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (application_id, slot)
         DO UPDATE SET object_key = $3, width = $4, height = $5`,
        [row.id, slot, objectKey, photo.width, photo.height],
      );
      return json(200, { slot, width: photo.width, height: photo.height });
    },
  },
  {
    method: 'POST',
    path: '/api/applications/:id/submit',
    auth: 'public',
    body: 'json',
    handler: async (ctx: Ctx): Promise<Reply> => {
      const row = await applicationFromToken(ctx);
      if (row.status !== 'draft') throw conflict('already_submitted');
      const minor = await recomputeMinor(row, ctx.nowMs);
      const fields = new FieldErrors();
      if (!row.first_name) fields.add('firstName', fieldCopy.required('First name'));
      if (!row.last_name) fields.add('lastName', fieldCopy.required('Last name'));
      if (!row.email) fields.add('email', fieldCopy.required('Email'));
      if (!row.date_of_birth) fields.add('dateOfBirth', fieldCopy.required('Date of birth'));
      if (row.height_cm === null) fields.add('height', fieldCopy.required('Height'));
      if (!row.bio) fields.add('bio', fieldCopy.required('Bio'));
      const slots = await photoSlots(row.id);
      for (const slot of PHOTO_SLOTS) {
        if (!slots.includes(slot)) fields.add(`photo_${slot}`, PHOTO_REQUIRED_COPY[slot]);
      }
      if (minor) {
        if (!row.guardian_name) fields.add('guardianName', fieldCopy.required('Guardian name'));
        if (!row.guardian_email) fields.add('guardianEmail', fieldCopy.required('Guardian email'));
      }
      fields.throwIfAny();

      if (!minor) {
        await query(
          `UPDATE applications SET status = 'submitted', minor = false, submitted_at = $2 WHERE id = $1`,
          [row.id, new Date(ctx.nowMs)],
        );
        return json(200, { status: 'submitted', minor: false });
      }
      const consentToken = newToken();
      await transaction(async (tx) => {
        await tx.query(
          `UPDATE applications SET status = 'awaiting_guardian', minor = true, submitted_at = $2,
                  consent_token = $3, consent_issued_at = $2, consent_expires_at = $4
           WHERE id = $1`,
          [
            row.id,
            new Date(ctx.nowMs),
            consentToken,
            new Date(ctx.nowMs + config.consentLinkTtlSeconds * 1000),
          ],
        );
        await queueMail(
          guardianConsentEmail({
            recipient: row.guardian_email as string,
            guardianName: row.guardian_name as string,
            firstName: row.first_name as string,
            token: consentToken,
          }),
          tx,
        );
      });
      return json(200, { status: 'awaiting_guardian', minor: true });
    },
  },
  {
    method: 'GET',
    path: '/api/consents/:token',
    auth: 'public',
    handler: async (ctx: Ctx): Promise<Reply> => {
      const row = await consentApplication(ctx.params.token, ctx.nowMs);
      return json(200, {
        applicantFirstName: row.first_name,
        office: row.office_id,
        expiresAt: toIsoInstant((row.consent_expires_at as Date).getTime()),
      });
    },
  },
  {
    method: 'POST',
    path: '/api/consents/:token',
    auth: 'public',
    body: 'json',
    handler: async (ctx: Ctx): Promise<Reply> => {
      const row = await consentApplication(ctx.params.token, ctx.nowMs);
      const decision = readString(ctx.json, 'decision') ?? '';
      if (decision !== 'approve' && decision !== 'decline') {
        throw validation({ decision: 'Choose approve or decline.' });
      }
      await query(
        `UPDATE applications SET status = $2, consent_used_at = $3, consent_decision = $4 WHERE id = $1`,
        [row.id, decision === 'approve' ? 'submitted' : 'declined', new Date(ctx.nowMs), decision],
      );
      return json(200, { decision });
    },
  },
  {
    method: 'GET',
    path: '/api/applications',
    auth: 'session',
    roles: ['scout', 'agency_director'],
    handler: async (ctx: Ctx): Promise<Reply> => {
      const status = ctx.url.searchParams.get('status');
      const allowed: ApplicationStatus[] = ['submitted', 'awaiting_guardian', 'approved', 'declined', 'signed'];
      if (status && !allowed.includes(status as ApplicationStatus)) {
        throw validation({ status: 'Choose one of the published statuses.' });
      }
      const rows = await query<ApplicationRow>(
        `SELECT * FROM applications
         WHERE status <> 'draft' AND ($1::text IS NULL OR status = $1)
         ORDER BY submitted_at DESC NULLS LAST, created_at DESC`,
        [status],
      );
      const applications: Array<Record<string, unknown>> = [];
      for (const row of rows) applications.push(await reviewView(row));
      return json(200, { applications });
    },
  },
  {
    method: 'GET',
    path: '/api/applications/:id/photos/:slot',
    auth: 'session',
    roles: ['scout', 'agency_director'],
    handler: async (ctx: Ctx): Promise<Reply> => {
      const row = await queryOne<{ object_key: string }>(
        'SELECT object_key FROM application_photos WHERE application_id = $1 AND slot = $2',
        [ctx.params.id, ctx.params.slot],
      );
      if (!row) throw notFound();
      const bytes = await getObject(row.object_key);
      if (!bytes) throw notFound();
      return { status: 200, body: bytes, contentType: 'image/jpeg' };
    },
  },
  {
    method: 'POST',
    path: '/api/applications/:id/decision',
    auth: 'session',
    roles: ['scout', 'agency_director'],
    body: 'json',
    load: async (ctx: Ctx): Promise<void> => {
      if (!(await findApplication(ctx.params.id))) throw notFound();
    },
    handler: async (ctx: Ctx): Promise<Reply> => {
      const member = ctx.member as MemberRow;
      const row = await findApplication(ctx.params.id);
      if (!row) throw notFound();
      if (row.status === 'awaiting_guardian') throw conflict('awaiting_guardian');
      if (row.status !== 'submitted') {
        throw conflict('already_decided', {
          decidedBy: row.decided_by_name,
          decidedAt: row.decided_at ? toIsoInstant(row.decided_at.getTime()) : null,
        });
      }
      const decision = readString(ctx.json, 'decision') ?? '';
      if (decision !== 'approve' && decision !== 'decline') {
        throw validation({ decision: 'Choose approve or decline.' });
      }
      await query(
        `UPDATE applications SET status = $2, decision = $3, decided_by = $4, decided_by_name = $5, decided_at = $6
         WHERE id = $1`,
        [
          row.id,
          decision === 'approve' ? 'approved' : 'declined',
          decision,
          member.id,
          member.name,
          new Date(ctx.nowMs),
        ],
      );
      const updated = await findApplication(row.id);
      if (!updated) throw notFound();
      return json(200, await reviewView(updated));
    },
  },
  {
    method: 'POST',
    path: '/api/applications/:id/sign',
    auth: 'session',
    roles: ['scout', 'agency_director'],
    body: 'json',
    load: async (ctx: Ctx): Promise<void> => {
      if (!(await findApplication(ctx.params.id))) throw notFound();
    },
    handler: async (ctx: Ctx): Promise<Reply> => {
      const row = await findApplication(ctx.params.id);
      if (!row) throw notFound();
      if (row.status !== 'approved') throw conflict('not_approved');
      const talent = await insertTalent({
        displayName: `${row.first_name ?? ''} ${row.last_name ?? ''}`.trim(),
        office: row.office_id,
        board: 'new_faces',
        email: row.email,
        dateOfBirth: row.date_of_birth,
        guardianName: row.guardian_name,
        guardianEmail: row.guardian_email,
        heightCm: row.height_cm,
        instagram: row.instagram_followers ?? 0,
      });
      await copyApplicationPhotos(row.id, talent);
      await query(`UPDATE applications SET status = 'signed', talent_id = $2 WHERE id = $1`, [
        row.id,
        talent.id,
      ]);
      const photos = await query<{ id: string; width: number; height: number }>(
        'SELECT id, width, height FROM photos WHERE talent_id = $1 ORDER BY position',
        [talent.id],
      );
      return json(201, {
        talent: {
          id: talent.id,
          slug: talent.slug,
          displayName: talent.display_name,
          state: talent.state,
          office: talent.office_id,
          board: talent.board,
          dateOfBirth: talent.date_of_birth,
          email: talent.email,
          phone: talent.phone,
          homeAddress: talent.home_address,
          guardian: talent.guardian_name || talent.guardian_email
            ? { name: talent.guardian_name, email: talent.guardian_email, phone: talent.guardian_phone }
            : null,
          measurements: {
            heightCm: talent.height_cm,
            chestCm: talent.chest_cm,
            waistCm: talent.waist_cm,
            hipsCm: talent.hips_cm,
          },
          reach: {
            instagram: talent.instagram,
            tiktok: talent.tiktok,
            youtube: talent.youtube,
            total: talent.instagram + talent.tiktok + talent.youtube,
          },
          officeNote: talent.office_note,
          portfolio: photos.map((photo) => ({
            photoId: photo.id,
            url: `/api/photos/${photo.id}`,
            width: photo.width,
            height: photo.height,
          })),
          version: talent.version,
          portfolioVersion: talent.portfolio_version,
        },
      });
    },
  },
];

const PHOTO_REQUIRED_COPY: Record<PhotoSlot, string> = {
  front: fieldCopy.required('Front photo'),
  profile: fieldCopy.required('Profile photo'),
  full_length: fieldCopy.required('Full-length photo'),
  smile: fieldCopy.required('Smiling photo'),
};

async function findApplication(id: string): Promise<ApplicationRow | null> {
  return queryOne<ApplicationRow>('SELECT * FROM applications WHERE id = $1', [id]);
}

/** The guardian link works once and expires on its own. */
async function consentApplication(token: string, nowMs: number): Promise<ApplicationRow> {
  const row = await queryOne<ApplicationRow>('SELECT * FROM applications WHERE consent_token = $1', [token]);
  if (!row || !row.consent_expires_at) throw notFound();
  if (row.consent_used_at) throw gone('link_used');
  if (nowMs >= row.consent_expires_at.getTime()) throw gone('link_expired');
  return row;
}

async function copyApplicationPhotos(applicationId: string, talent: TalentRow): Promise<void> {
  const rows = await query<{ slot: PhotoSlot; object_key: string; width: number; height: number }>(
    'SELECT slot, object_key, width, height FROM application_photos WHERE application_id = $1',
    [applicationId],
  );
  const ordered = PHOTO_SLOTS.map((slot) => rows.find((row) => row.slot === slot)).filter(
    (row): row is { slot: PhotoSlot; object_key: string; width: number; height: number } => row !== undefined,
  );
  for (const [index, row] of ordered.entries()) {
    const bytes = await getObject(row.object_key);
    if (!bytes) continue;
    const photoId = newId('pho');
    const objectKey = `portfolio/${talent.id}/${photoId}.jpg`;
    await putObject(objectKey, bytes, 'image/jpeg');
    await query(
      `INSERT INTO photos (id, talent_id, position, object_key, width, height, bytes)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [photoId, talent.id, index, objectKey, row.width, row.height, bytes.length],
    );
  }
}
