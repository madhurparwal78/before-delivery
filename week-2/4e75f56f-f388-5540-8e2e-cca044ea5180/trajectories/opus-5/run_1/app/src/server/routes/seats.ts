import { pool, withTransaction } from '../db/pool.js';
import { randomObjectId } from '../db/ids.js';
import { loadReservation, serializeReservation } from '../db/reservations.js';
import { queueSeatAssignment } from '../domain/notifications.js';
import { ASSIGNABLE_STATES, SOLD_STATES } from '../domain/reservationState.js';
import { serverNow } from '../domain/venue.js';
import { deleteObject, objectExists, presignGet, putObject } from '../services/s3.js';
import { FILE_LIMIT, type Route } from '../http/context.js';
import {
  conflict,
  fileTooLarge,
  invalidTransition,
  notFound,
  unsupportedFileType,
  validation,
} from '../http/errors.js';
import { extensionFor, sniffUploadType } from '../http/multipart.js';
import { FieldErrors, isAttendee, isRegistrar, readEmail, readString } from './helpers.js';

const SIGNED_LINK_SECONDS = 60;

const RECEIPT_KINDS = new Set([
  'deposit-receipt',
  'balance-receipt',
  'full-receipt',
  'upgrade-receipt',
]);
const ATTENDEE_KINDS = new Set(['visa-letter', 'certificate']);

function singleFile(files: readonly { field: string; content: Buffer }[]): Buffer {
  const uploads = files.filter((file) => file.field === 'file');
  if (uploads.length > 1) throw validation({ file: 'Send exactly one file.' });
  const file = uploads[0];
  if (file === undefined) throw validation({ file: 'Attach a PDF, JPEG or PNG file.' });
  return file.content;
}

function checkedUpload(content: Buffer): { type: 'application/pdf' | 'image/jpeg' | 'image/png' } {
  if (content.byteLength > FILE_LIMIT) throw fileTooLarge();
  const type = sniffUploadType(content);
  if (type === null) throw unsupportedFileType();
  return { type };
}

export const seatRoutes: readonly Route[] = [
  {
    method: 'PUT',
    pattern: '/api/reservations/:id/assignee',
    access: ['practitioner', 'clinic'],
    handler: async (ctx) => {
      const account = ctx.signedIn();
      const id = ctx.param('id');
      const body = ctx.json();

      const reservation = await loadReservation(pool, id);
      if (reservation === null || reservation.buyer_id !== account.id) throw notFound();
      if (!ASSIGNABLE_STATES.includes(reservation.state)) throw invalidTransition();

      const errors = new FieldErrors();
      const name = readString(body, 'name', 1, 120, errors);
      const email = readEmail(body, 'email', errors);
      errors.throwIfAny();

      const engaged = await pool.query<{ taken: boolean }>(
        `select exists(
           select 1 from reservations r join accounts a on a.id = r.attendee_account_id
           where lower(a.email) = lower($1) and r.state = any($2::text[]) and r.id <> $3
         ) as taken`,
        [email, SOLD_STATES, id],
      );
      if (engaged.rows[0]?.taken === true) {
        throw conflict('already_attending', 'That colleague already attends another seat.');
      }

      const removed = await withTransaction(async (client) => {
        const licence = await client.query<{ s3_key: string }>(
          'delete from licences where reservation_id = $1 returning s3_key',
          [id],
        );
        const passport = await client.query<{ s3_key: string }>(
          'delete from passports where reservation_id = $1 returning s3_key',
          [id],
        );
        const visa = await client.query<{ s3_key: string }>(
          `delete from documents where reservation_id = $1 and kind = 'visa-letter' returning s3_key`,
          [id],
        );
        const updated = await client.query<{ assignment_seq: number }>(
          `update reservations
           set assignee_name = $2, assignee_email = $3, assignee_email_lower = lower($3),
               assignee_accepted = false, attendee_account_id = null,
               assignment_seq = assignment_seq + 1
           where id = $1
           returning assignment_seq`,
          [id, name, email],
        );
        const buyerLabel =
          reservation.buyer_role === 'clinic'
            ? (reservation.buyer_clinic ?? reservation.buyer_name)
            : reservation.buyer_name;
        await queueSeatAssignment(
          client,
          id,
          String(updated.rows[0]?.assignment_seq ?? 1),
          email,
          buyerLabel,
          reservation.bench,
        );
        return [
          ...licence.rows.map((row) => row.s3_key),
          ...passport.rows.map((row) => row.s3_key),
          ...visa.rows.map((row) => row.s3_key),
        ];
      });

      for (const key of removed) {
        await deleteObject(key).catch(() => undefined);
      }

      const refreshed = await loadReservation(pool, id);
      if (refreshed === null) throw notFound();
      return { status: 200, body: { reservation: serializeReservation(refreshed, serverNow()) } };
    },
  },
  {
    method: 'POST',
    pattern: '/api/reservations/:id/accept',
    access: ['practitioner', 'clinic'],
    handler: async (ctx) => {
      const account = ctx.signedIn();
      const id = ctx.param('id');

      const reservation = await loadReservation(pool, id);
      if (
        reservation === null ||
        reservation.assignee_email_lower === null ||
        reservation.assignee_email_lower !== account.email.toLowerCase()
      ) {
        throw notFound();
      }
      if (!reservation.assignee_accepted) {
        const engaged = await pool.query<{ taken: boolean }>(
          `select exists(
             select 1 from reservations
             where attendee_account_id = $1 and state = any($2::text[]) and id <> $3
           ) as taken`,
          [account.id, SOLD_STATES, id],
        );
        if (engaged.rows[0]?.taken === true) {
          throw conflict('already_attending', 'This account already attends another seat.');
        }
        await pool.query(
          `update reservations set assignee_accepted = true, attendee_account_id = $2 where id = $1`,
          [id, account.id],
        );
      }
      const refreshed = await loadReservation(pool, id);
      if (refreshed === null) throw notFound();
      return { status: 200, body: { reservation: serializeReservation(refreshed, serverNow()) } };
    },
  },
  {
    method: 'POST',
    pattern: '/api/reservations/:id/licence',
    access: ['practitioner', 'clinic'],
    handler: async (ctx) => {
      const account = ctx.signedIn();
      const id = ctx.param('id');
      const parsed = ctx.multipart();

      const reservation = await loadReservation(pool, id);
      if (reservation === null || reservation.attendee_account_id !== account.id) throw notFound();
      if (reservation.licence_status === 'matched') {
        throw conflict('licence_locked', 'A matched licence cannot be replaced.');
      }

      const errors = new FieldErrors();
      const licenceNumber = readString(parsed.fields, 'licence_number', 1, 40, errors);
      const licenceState = readString(parsed.fields, 'licence_state', 1, 60, errors);
      errors.throwIfAny();
      const content = singleFile(parsed.files);
      const { type } = checkedUpload(content);

      const key = `licences/${id}/${randomObjectId()}.${extensionFor(type)}`;
      await putObject(key, content, type);
      await pool.query(
        `insert into licences (reservation_id, licence_number, licence_state, status, s3_key, content_type)
         values ($1, $2, $3, 'submitted', $4, $5)
         on conflict (reservation_id) do update
         set licence_number = $2, licence_state = $3, status = 'submitted', s3_key = $4,
             content_type = $5, note = null`,
        [id, licenceNumber, licenceState, key, type],
      );
      const refreshed = await loadReservation(pool, id);
      if (refreshed === null) throw notFound();
      return { status: 201, body: { reservation: serializeReservation(refreshed, serverNow()) } };
    },
  },
  {
    method: 'POST',
    pattern: '/api/reservations/:id/passport',
    access: ['practitioner', 'clinic'],
    handler: async (ctx) => {
      const account = ctx.signedIn();
      const id = ctx.param('id');
      const parsed = ctx.multipart();

      const reservation = await loadReservation(pool, id);
      if (reservation === null || reservation.attendee_account_id !== account.id) throw notFound();

      const errors = new FieldErrors();
      const fullName = readString(parsed.fields, 'full_name', 1, 120, errors);
      const nationality = readString(parsed.fields, 'nationality', 1, 120, errors);
      const passportNumber = readString(parsed.fields, 'passport_number', 1, 120, errors);
      errors.throwIfAny();
      const content = singleFile(parsed.files);
      const { type } = checkedUpload(content);

      const key = `passports/${id}/${randomObjectId()}.${extensionFor(type)}`;
      await putObject(key, content, type);
      await pool.query(
        `insert into passports (reservation_id, full_name, nationality, passport_number, s3_key, content_type)
         values ($1, $2, $3, $4, $5, $6)
         on conflict (reservation_id) do update
         set full_name = $2, nationality = $3, passport_number = $4, s3_key = $5, content_type = $6`,
        [id, fullName, nationality, passportNumber, key, type],
      );
      const refreshed = await loadReservation(pool, id);
      if (refreshed === null) throw notFound();
      return { status: 201, body: { reservation: serializeReservation(refreshed, serverNow()) } };
    },
  },
  {
    method: 'GET',
    pattern: '/api/reservations/:id/licence',
    access: ['practitioner', 'clinic', 'registrar'],
    handler: async (ctx) => {
      const account = ctx.signedIn();
      const id = ctx.param('id');
      const reservation = await loadReservation(pool, id);
      if (reservation === null) throw notFound();
      const maySee = isRegistrar(account) || isAttendee(reservation, account);
      if (!maySee) throw notFound();
      const licence = await pool.query<{
        licence_number: string;
        licence_state: string;
        status: string;
        s3_key: string;
      }>(
        'select licence_number, licence_state, status, s3_key from licences where reservation_id = $1',
        [id],
      );
      const row = licence.rows[0];
      if (row === undefined) throw notFound();
      return {
        status: 200,
        body: {
          licence_number: row.licence_number,
          licence_state: row.licence_state,
          status: row.status,
          url: presignGet(row.s3_key, SIGNED_LINK_SECONDS),
          expires_in: SIGNED_LINK_SECONDS,
        },
      };
    },
  },
  {
    method: 'GET',
    pattern: '/api/reservations/:id/passport',
    access: ['practitioner', 'clinic', 'registrar'],
    handler: async (ctx) => {
      const account = ctx.signedIn();
      const id = ctx.param('id');
      const reservation = await loadReservation(pool, id);
      if (reservation === null) throw notFound();
      const maySee = isRegistrar(account) || isAttendee(reservation, account);
      if (!maySee) throw notFound();
      const passport = await pool.query<{
        full_name: string;
        nationality: string;
        passport_number: string;
        s3_key: string;
      }>(
        'select full_name, nationality, passport_number, s3_key from passports where reservation_id = $1',
        [id],
      );
      const row = passport.rows[0];
      if (row === undefined) throw notFound();
      return {
        status: 200,
        body: {
          full_name: row.full_name,
          nationality: row.nationality,
          passport_number: row.passport_number,
          url: presignGet(row.s3_key, SIGNED_LINK_SECONDS),
          expires_in: SIGNED_LINK_SECONDS,
        },
      };
    },
  },
  {
    method: 'GET',
    pattern: '/api/reservations/:id/documents/:kind',
    access: ['practitioner', 'clinic', 'registrar'],
    handler: async (ctx) => {
      const account = ctx.signedIn();
      const id = ctx.param('id');
      const kind = ctx.param('kind');
      if (!RECEIPT_KINDS.has(kind) && !ATTENDEE_KINDS.has(kind)) throw notFound();

      const reservation = await loadReservation(pool, id);
      if (reservation === null) throw notFound();
      const maySee = isRegistrar(account)
        ? true
        : RECEIPT_KINDS.has(kind)
          ? reservation.buyer_id === account.id
          : isAttendee(reservation, account);
      if (!maySee) throw notFound();

      const document = await pool.query<{ s3_key: string }>(
        'select s3_key from documents where reservation_id = $1 and kind = $2',
        [id, kind],
      );
      const row = document.rows[0];
      if (row === undefined) throw notFound();
      await objectExists(row.s3_key);
      return {
        status: 200,
        body: { url: presignGet(row.s3_key, SIGNED_LINK_SECONDS), expires_in: SIGNED_LINK_SECONDS },
      };
    },
  },
  {
    method: 'GET',
    pattern: '/api/groups/:id/documents/invoice',
    access: ['practitioner', 'clinic', 'registrar'],
    handler: async (ctx) => {
      const account = ctx.signedIn();
      const id = ctx.param('id');
      const group = await pool.query<{ buyer_id: string }>(
        'select buyer_id from groups where id = $1',
        [id],
      );
      const row = group.rows[0];
      if (row === undefined) throw notFound();
      if (!isRegistrar(account) && row.buyer_id !== account.id) throw notFound();
      const document = await pool.query<{ s3_key: string }>(
        `select s3_key from documents where group_id = $1 and kind = 'invoice'`,
        [id],
      );
      const found = document.rows[0];
      if (found === undefined) throw notFound();
      await objectExists(found.s3_key);
      return {
        status: 200,
        body: {
          url: presignGet(found.s3_key, SIGNED_LINK_SECONDS),
          expires_in: SIGNED_LINK_SECONDS,
        },
      };
    },
  },
];
