import { randomBytes } from 'node:crypto';
import { MAX_FORM_FILE_BYTES, VERIFICATION_LINK_TTL_SECONDS } from '../../shared/contract.js';
import { viewerOf } from '../auth/sessions.js';
import { findAssignmentById, lockAssignment } from '../db/assignments.js';
import { pool, withTransaction, type Queryable } from '../db/pool.js';
import { emailOf } from '../db/users.js';
import type { AssignmentRecord, SeatRecord } from '../domain/records.js';
import { CLAIMABLE_FROM, GIVE_BACK_FROM, VERIFIABLE_FROM } from '../../shared/transitions.js';
import { acceptedFormType, extensionFor } from '../domain/verificationFile.js';
import { isAgencyStaff } from '../domain/visibility.js';
import { fail } from '../http/errors.js';
import { parseMultipart } from '../http/multipart.js';
import type { AuthenticatedContext, Reply, Route } from '../http/router.js';
import { FieldErrors } from '../http/validation.js';
import { recomputeCoverage } from '../services/assignmentFlow.js';
import { enqueueSeatConfirmation } from '../services/notifications.js';
import { headObject, putObject, StorageUnavailableError } from '../services/storage.js';
import { loadVisibleAssignment, requireRole, seatNumberParam, viewAs } from './support.js';

const INTERPRETER_LOCK_NAMESPACE = 5513;

function seatOf(record: AssignmentRecord, seatNo: number): SeatRecord {
  const seat = record.seats.find((candidate) => candidate.seat_no === seatNo);
  if (seat === undefined) {
    fail('not_found');
  }
  return seat;
}

async function overlapsHeldSeat(
  db: Queryable,
  interpreterId: number,
  record: AssignmentRecord,
): Promise<boolean> {
  const result = await db.query<{ one: number }>(
    `SELECT 1 AS one
     FROM seats s
     JOIN assignments a ON a.id = s.assignment_id
     WHERE s.holder_id = $1
       AND a.id <> $2
       AND a.status <> 'cancelled'
       AND a.start_at < $3
       AND a.start_at + (a.duration_minutes || ' minutes')::interval > $4
     LIMIT 1`,
    [
      interpreterId,
      record.id,
      new Date(record.start_at.getTime() + record.duration_minutes * 60000),
      record.start_at,
    ],
  );
  return result.rows.length > 0;
}

const claimSeat: Route = {
  method: 'POST',
  pattern: '/api/assignments/:number/seats/:seat/claim',
  body: 'json',
  auth: true,
  handler: async (ctx): Promise<Reply> => {
    const visible = await loadVisibleAssignment(ctx);
    requireRole(ctx, ['interpreter']);
    const seatNo = seatNumberParam(ctx);
    seatOf(visible.record, seatNo);
    const viewer = viewerOf(ctx.session);

    return withTransaction(async (tx) => {
      await tx.query('SELECT pg_advisory_xact_lock($1, $2)', [INTERPRETER_LOCK_NAMESPACE, viewer.id]);
      await lockAssignment(tx, visible.record.id);
      const record = await findAssignmentById(tx, visible.record.id);
      const seat = seatOf(record, seatNo);

      if (!CLAIMABLE_FROM.includes(record.status) || seat.status !== 'open') {
        fail('seat_taken');
      }
      if (record.seats.some((candidate) => candidate.holder_id === viewer.id)) {
        fail('already_holding');
      }
      if (await overlapsHeldSeat(tx, viewer.id, record)) {
        fail('calendar_conflict');
      }

      await tx.query("UPDATE seats SET status = 'held', holder_id = $1 WHERE id = $2", [viewer.id, seat.seat_id]);
      const hold = await tx.query<{ id: number }>(
        'INSERT INTO holds (assignment_id, seat_no, interpreter_id) VALUES ($1, $2, $3) RETURNING id',
        [record.id, seatNo, viewer.id],
      );
      const holdId = hold.rows[0]?.id;
      if (holdId === undefined) {
        throw new Error('hold insert returned no id');
      }
      const updated = await recomputeCoverage(tx, record.id);
      await enqueueSeatConfirmation(tx, updated, seatNo, holdId, await emailOf(tx, viewer.id));
      return { status: 200, body: viewAs(updated, viewer) };
    });
  },
};

const giveBackSeat: Route = {
  method: 'POST',
  pattern: '/api/assignments/:number/seats/:seat/give-back',
  body: 'json',
  auth: true,
  handler: async (ctx): Promise<Reply> => {
    const visible = await loadVisibleAssignment(ctx);
    requireRole(ctx, ['interpreter']);
    const seatNo = seatNumberParam(ctx);
    seatOf(visible.record, seatNo);
    const viewer = viewerOf(ctx.session);

    return withTransaction(async (tx) => {
      await lockAssignment(tx, visible.record.id);
      const record = await findAssignmentById(tx, visible.record.id);
      const seat = seatOf(record, seatNo);
      if (seat.holder_id !== viewer.id) {
        fail('forbidden');
      }
      if (!GIVE_BACK_FROM.includes(record.status) || seat.status !== 'held') {
        fail('invalid_transition');
      }
      await tx.query("UPDATE seats SET status = 'open', holder_id = NULL WHERE id = $1", [seat.seat_id]);
      await tx.query(
        `UPDATE holds SET ended_at = now(), outcome = 'released_back'
         WHERE assignment_id = $1 AND seat_no = $2 AND interpreter_id = $3 AND ended_at IS NULL`,
        [record.id, seatNo, viewer.id],
      );
      const updated = await recomputeCoverage(tx, record.id);
      return { status: 200, body: viewAs(updated, viewer) };
    });
  },
};

function validateMinutes(errors: FieldErrors, raw: string | undefined): number | null {
  const value = Number(raw);
  if (raw === undefined || !Number.isInteger(value) || value < 1 || value > 960) {
    errors.add('actual_minutes', 'Give the actual minutes worked, 1 to 960.');
    return null;
  }
  return value;
}

function validateMiles(errors: FieldErrors, raw: string | undefined): number | null {
  const value = Number(raw);
  if (raw === undefined || !Number.isInteger(value) || value < 0 || value > 1000) {
    errors.add('round_trip_miles', 'Give round-trip miles, 0 to 1,000.');
    return null;
  }
  return value;
}

const submitVerification: Route = {
  method: 'POST',
  pattern: '/api/assignments/:number/seats/:seat/verification',
  body: 'multipart',
  auth: true,
  handler: async (ctx): Promise<Reply> => {
    const visible = await loadVisibleAssignment(ctx);
    requireRole(ctx, ['interpreter']);
    const seatNo = seatNumberParam(ctx);
    const seat = seatOf(visible.record, seatNo);
    const viewer = viewerOf(ctx.session);
    if (seat.holder_id !== viewer.id) {
      fail('forbidden');
    }
    if (seat.verified) {
      fail('already_verified');
    }
    if (!VERIFIABLE_FROM.includes(visible.record.status) || seat.status !== 'held') {
      fail('invalid_transition');
    }

    const parsed = await parseMultipart(
      ctx.rawBody,
      String(ctx.headers['content-type']),
      MAX_FORM_FILE_BYTES,
    );
    const errors = new FieldErrors();
    const actualMinutes = validateMinutes(errors, parsed.fields['actual_minutes']);
    const roundTripMiles = validateMiles(errors, parsed.fields['round_trip_miles']);
    const file = parsed.files.find((candidate) => candidate.fieldName === 'form');
    const formType = file === undefined ? null : acceptedFormType(file.declaredType, file.data);
    if (file === undefined || formType === null) {
      errors.add('form', 'Upload a PDF, JPEG or PNG file.');
    }
    errors.throwIfAny();
    if (actualMinutes === null || roundTripMiles === null || file === undefined || formType === null) {
      throw new Error('validated verification input is incomplete');
    }

    const objectKey = `verifications/${visible.record.number}/seat-${seatNo}/${randomBytes(16).toString('hex')}.${extensionFor(formType)}`;
    try {
      await putObject(objectKey, file.data, formType);
    } catch (error) {
      if (error instanceof StorageUnavailableError) {
        fail('storage_unavailable');
      }
      throw error;
    }

    return withTransaction(async (tx) => {
      await lockAssignment(tx, visible.record.id);
      await tx.query(
        `INSERT INTO verifications (seat_id, interpreter_id, actual_minutes, round_trip_miles, object_key, content_type, size_bytes)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [seat.seat_id, viewer.id, actualMinutes, roundTripMiles, objectKey, formType, file.data.byteLength],
      );
      await tx.query("UPDATE seats SET status = 'served' WHERE id = $1", [seat.seat_id]);
      await tx.query(
        "UPDATE holds SET ended_at = now(), outcome = 'served' WHERE assignment_id = $1 AND seat_no = $2 AND ended_at IS NULL",
        [visible.record.id, seatNo],
      );
      const updated = await recomputeCoverage(tx, visible.record.id);
      return { status: 201, body: viewAs(updated, viewer) };
    });
  },
};

const verificationLink: Route = {
  method: 'GET',
  pattern: '/api/assignments/:number/seats/:seat/verification-link',
  body: 'none',
  auth: true,
  handler: async (ctx: AuthenticatedContext): Promise<Reply> => {
    const visible = await loadVisibleAssignment(ctx);
    const seatNo = seatNumberParam(ctx);
    const seat = seatOf(visible.record, seatNo);
    const viewer = viewerOf(ctx.session);
    const permitted =
      isAgencyStaff(viewer) ||
      ((viewer.role === 'scheduler' || viewer.role === 'org_admin') && visible.record.org_id === viewer.orgId) ||
      (viewer.role === 'interpreter' && seat.holder_id === viewer.id);
    if (!permitted) {
      fail('forbidden');
    }

    const stored = await pool.query<{ object_key: string }>(
      'SELECT object_key FROM verifications WHERE seat_id = $1',
      [seat.seat_id],
    );
    const objectKey = stored.rows[0]?.object_key;
    if (objectKey === undefined) {
      fail('not_found');
    }
    try {
      await headObject(objectKey);
    } catch (error) {
      if (error instanceof StorageUnavailableError) {
        fail('storage_unavailable');
      }
      throw error;
    }

    const token = randomBytes(24).toString('base64url');
    await pool.query(
      "INSERT INTO file_tokens (token, session_id, seat_id, expires_at) VALUES ($1, $2, $3, now() + ($4 || ' seconds')::interval)",
      [token, ctx.session.id, seat.seat_id, String(VERIFICATION_LINK_TTL_SECONDS)],
    );
    return {
      status: 200,
      body: { url: `/files/${token}`, expires_in_seconds: VERIFICATION_LINK_TTL_SECONDS },
    };
  },
};

export const seatRoutes = [claimSeat, giveBackSeat, submitVerification, verificationLink];
