import { viewerOf } from '../auth/sessions.js';
import {
  findAssignmentById,
  lockAssignment,
  nextAssignmentNumber,
  queryAssignments,
} from '../db/assignments.js';
import { pool, withTransaction, type Queryable } from '../db/pool.js';
import { emailOf } from '../db/users.js';
import {
  validateCity,
  validateDayWindow,
  validateDuration,
  validateLanguage,
  validateMedicalNotes,
  validatePatientInitials,
  validateSetting,
  validateStartAt,
  validateStreetAddress,
} from '../domain/assignmentInput.js';
import { cancellationDecision } from '../domain/cancellation.js';
import { businessMinutesBetween, isLateNotice } from '../domain/businessMinutes.js';
import type { AssignmentRecord } from '../domain/records.js';
import { seatCountFor } from '../domain/seats.js';
import { CANCELLABLE_FROM, RELEASABLE_FROM, TIME_CHANGE_FROM } from '../../shared/transitions.js';
import { assignmentViewFor } from '../domain/visibility.js';
import { fail } from '../http/errors.js';
import {
  bodyFingerprint,
  claimIdempotencyKey,
  requireIdempotencyKey,
  storeIdempotentResponse,
} from '../http/idempotency.js';
import type { Reply, Route } from '../http/router.js';
import { FieldErrors, integerField, parseJsonBody, stringField } from '../http/validation.js';
import { markBillable, requireRateInForce } from '../services/billing.js';
import {
  enqueueCancellationNotices,
  enqueueOfferEmails,
  enqueueTimeChangeNotices,
} from '../services/notifications.js';
import { loadVisibleAssignment, requireRole, viewAs } from './support.js';

async function seededLanguageCodes(db: Queryable): Promise<string[]> {
  const result = await db.query<{ code: string }>('SELECT code FROM languages ORDER BY sort_order');
  return result.rows.map((row) => row.code);
}

async function insertSeats(db: Queryable, assignmentId: number, seatCount: number): Promise<void> {
  for (let seatNo = 1; seatNo <= seatCount; seatNo += 1) {
    await db.query('INSERT INTO seats (assignment_id, seat_no) VALUES ($1, $2)', [assignmentId, seatNo]);
  }
}

const createAssignment: Route = {
  method: 'POST',
  pattern: '/api/assignments',
  body: 'json',
  auth: true,
  handler: async (ctx): Promise<Reply> => {
    requireRole(ctx, ['scheduler']);
    const key = requireIdempotencyKey(ctx.headers['idempotency-key']);
    const body = parseJsonBody(ctx.rawBody);
    const fingerprint = bodyFingerprint(body);
    const viewer = viewerOf(ctx.session);
    const orgId = ctx.session.user.org_id;
    if (orgId === null) {
      fail('forbidden');
    }

    return withTransaction(async (tx) => {
      const claim = await claimIdempotencyKey(tx, ctx.session.user.id, key, fingerprint);
      if (!claim.owned) {
        return {
          status: claim.storedStatus ?? 201,
          body: claim.storedBody,
          headers: { 'idempotent-replay': 'true' },
        };
      }

      const errors = new FieldErrors();
      const language = validateLanguage(errors, stringField(body, 'language'), await seededLanguageCodes(tx));
      const setting = validateSetting(errors, stringField(body, 'setting'));
      const startAt = validateStartAt(errors, stringField(body, 'start_at'), new Date());
      const durationMinutes = validateDuration(errors, integerField(body, 'duration_minutes'));
      const streetAddress = validateStreetAddress(errors, stringField(body, 'street_address'));
      const city = validateCity(errors, stringField(body, 'city'));
      const patientInitials = validatePatientInitials(errors, stringField(body, 'patient_initials'));
      const medicalNotes = validateMedicalNotes(errors, stringField(body, 'medical_notes'));
      if (startAt !== null && durationMinutes !== null) {
        validateDayWindow(errors, startAt, durationMinutes);
      }
      errors.throwIfAny();
      if (
        language === null ||
        setting === null ||
        startAt === null ||
        durationMinutes === null ||
        streetAddress === null ||
        city === null ||
        patientInitials === null ||
        medicalNotes === null
      ) {
        throw new Error('validated assignment input is incomplete');
      }

      const number = await nextAssignmentNumber(tx);
      const inserted = await tx.query<{ id: number }>(
        `INSERT INTO assignments (number, org_id, scheduler_id, language_code, setting, start_at,
                                  duration_minutes, street_address, city, patient_initials, medical_notes, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'draft')
         RETURNING id`,
        [
          number,
          orgId,
          ctx.session.user.id,
          language,
          setting,
          startAt,
          durationMinutes,
          streetAddress,
          city,
          patientInitials,
          medicalNotes,
        ],
      );
      const assignmentId = inserted.rows[0]?.id;
      if (assignmentId === undefined) {
        throw new Error('assignment insert returned no id');
      }
      await insertSeats(tx, assignmentId, seatCountFor(language, durationMinutes));
      const record = await findAssignmentById(tx, assignmentId);
      const view = viewAs(record, viewer);
      await storeIdempotentResponse(tx, claim.id, 201, view);
      return { status: 201, body: view };
    });
  },
};

const listAssignments: Route = {
  method: 'GET',
  pattern: '/api/assignments',
  body: 'none',
  auth: true,
  handler: async (ctx): Promise<Reply> => {
    requireRole(ctx, ['scheduler', 'org_admin', 'dispatcher', 'billing_lead']);
    const viewer = viewerOf(ctx.session);
    const search = ctx.query.get('q');
    const records = await queryAssignments(pool, {
      ...(viewer.orgId === null ? {} : { orgId: viewer.orgId }),
      ...(search === null ? {} : { search }),
    });
    return { status: 200, body: { assignments: records.map((record) => viewAs(record, viewer)) } };
  },
};

const getAssignment: Route = {
  method: 'GET',
  pattern: '/api/assignments/:number',
  body: 'none',
  auth: true,
  handler: async (ctx): Promise<Reply> => {
    const { record, kind } = await loadVisibleAssignment(ctx);
    return { status: 200, body: assignmentViewFor(record, kind) };
  },
};

interface TimeChange {
  startAt: Date;
  durationMinutes: number;
}

async function applyTimeChange(
  tx: Queryable,
  record: AssignmentRecord,
  change: TimeChange,
): Promise<AssignmentRecord> {
  const freedEmails: string[] = [];
  for (const seat of record.seats) {
    if (seat.holder_id !== null) {
      freedEmails.push(await emailOf(tx, seat.holder_id));
    }
  }
  await tx.query(
    "UPDATE holds SET ended_at = now(), outcome = 'time_changed' WHERE ended_at IS NULL AND assignment_id = $1",
    [record.id],
  );
  const seatCount = seatCountFor(record.language_code, change.durationMinutes);
  await tx.query("UPDATE seats SET status = 'open', holder_id = NULL WHERE assignment_id = $1", [record.id]);
  await tx.query('DELETE FROM seats WHERE assignment_id = $1 AND seat_no > $2', [record.id, seatCount]);
  for (let seatNo = 1; seatNo <= seatCount; seatNo += 1) {
    await tx.query(
      'INSERT INTO seats (assignment_id, seat_no) VALUES ($1, $2) ON CONFLICT (assignment_id, seat_no) DO NOTHING',
      [record.id, seatNo],
    );
  }

  const nextStatus = record.status === 'draft' ? 'draft' : 'released';
  await tx.query(
    `UPDATE assignments
     SET start_at = $1, duration_minutes = $2, status = $3, offer_round = offer_round + 1
     WHERE id = $4`,
    [change.startAt, change.durationMinutes, nextStatus, record.id],
  );
  const updated = await findAssignmentById(tx, record.id);
  await enqueueTimeChangeNotices(tx, updated, updated.offer_round, freedEmails);
  if (nextStatus === 'released') {
    await enqueueOfferEmails(tx, updated);
  }
  return updated;
}

const patchAssignment: Route = {
  method: 'PATCH',
  pattern: '/api/assignments/:number',
  body: 'json',
  auth: true,
  handler: async (ctx): Promise<Reply> => {
    const visible = await loadVisibleAssignment(ctx);
    requireRole(ctx, ['scheduler']);
    const body = parseJsonBody(ctx.rawBody);
    const viewer = viewerOf(ctx.session);

    return withTransaction(async (tx) => {
      await lockAssignment(tx, visible.record.id);
      const record = await findAssignmentById(tx, visible.record.id);
      if (!TIME_CHANGE_FROM.includes(record.status)) {
        fail('invalid_transition');
      }

      const touchesTime = 'start_at' in body || 'duration_minutes' in body;
      if (touchesTime && isLateNotice(businessMinutesBetween(new Date(), record.start_at))) {
        fail('late_change');
      }

      const errors = new FieldErrors();
      const startAt =
        'start_at' in body ? validateStartAt(errors, stringField(body, 'start_at'), new Date()) : record.start_at;
      const durationMinutes =
        'duration_minutes' in body
          ? validateDuration(errors, integerField(body, 'duration_minutes'))
          : record.duration_minutes;
      const streetAddress =
        'street_address' in body
          ? validateStreetAddress(errors, stringField(body, 'street_address'))
          : record.street_address;
      const city = 'city' in body ? validateCity(errors, stringField(body, 'city')) : record.city;
      const medicalNotes =
        'medical_notes' in body
          ? validateMedicalNotes(errors, stringField(body, 'medical_notes'))
          : record.medical_notes;
      if (startAt !== null && durationMinutes !== null) {
        validateDayWindow(errors, startAt, durationMinutes);
      }
      errors.throwIfAny();
      if (startAt === null || durationMinutes === null || streetAddress === null || city === null || medicalNotes === null) {
        throw new Error('validated assignment input is incomplete');
      }

      await tx.query('UPDATE assignments SET street_address = $1, city = $2, medical_notes = $3 WHERE id = $4', [
        streetAddress,
        city,
        medicalNotes,
        record.id,
      ]);
      const detailsOnly = await findAssignmentById(tx, record.id);
      const result = touchesTime
        ? await applyTimeChange(tx, detailsOnly, { startAt, durationMinutes })
        : detailsOnly;
      return { status: 200, body: viewAs(result, viewer) };
    });
  },
};

const releaseAssignment: Route = {
  method: 'POST',
  pattern: '/api/assignments/:number/release',
  body: 'json',
  auth: true,
  handler: async (ctx): Promise<Reply> => {
    const visible = await loadVisibleAssignment(ctx);
    requireRole(ctx, ['dispatcher']);
    const viewer = viewerOf(ctx.session);

    return withTransaction(async (tx) => {
      await lockAssignment(tx, visible.record.id);
      const record = await findAssignmentById(tx, visible.record.id);
      if (!RELEASABLE_FROM.includes(record.status)) {
        fail('invalid_transition');
      }
      await tx.query("UPDATE assignments SET status = 'released', offer_round = offer_round + 1 WHERE id = $1", [
        record.id,
      ]);
      const released = await findAssignmentById(tx, record.id);
      const offersSent = await enqueueOfferEmails(tx, released);
      return { status: 200, body: { assignment: viewAs(released, viewer), offers_sent: offersSent } };
    });
  },
};

const cancellationQuote: Route = {
  method: 'GET',
  pattern: '/api/assignments/:number/cancellation-quote',
  body: 'none',
  auth: true,
  handler: async (ctx): Promise<Reply> => {
    const { record } = await loadVisibleAssignment(ctx);
    requireRole(ctx, ['scheduler']);
    if (!CANCELLABLE_FROM.includes(record.status)) {
      fail('invalid_transition');
    }
    const rate = await requireRateInForce(pool, record);
    return {
      status: 200,
      body: cancellationDecision({
        status: record.status,
        seatCount: record.seats.length,
        startAt: record.start_at,
        now: new Date(),
        rate,
      }),
    };
  },
};

const cancelAssignment: Route = {
  method: 'POST',
  pattern: '/api/assignments/:number/cancel',
  body: 'json',
  auth: true,
  handler: async (ctx): Promise<Reply> => {
    const visible = await loadVisibleAssignment(ctx);
    requireRole(ctx, ['scheduler']);
    const viewer = viewerOf(ctx.session);

    return withTransaction(async (tx) => {
      await lockAssignment(tx, visible.record.id);
      const record = await findAssignmentById(tx, visible.record.id);
      if (!CANCELLABLE_FROM.includes(record.status)) {
        fail('invalid_transition');
      }
      const rate = await requireRateInForce(tx, record);
      const decision = cancellationDecision({
        status: record.status,
        seatCount: record.seats.length,
        startAt: record.start_at,
        now: new Date(),
        rate,
      });

      const holderEmails: string[] = [];
      for (const seat of record.seats) {
        if (seat.holder_id !== null) {
          holderEmails.push(await emailOf(tx, seat.holder_id));
        }
      }
      await tx.query(
        "UPDATE holds SET ended_at = now(), outcome = 'cancelled' WHERE ended_at IS NULL AND assignment_id = $1",
        [record.id],
      );
      await tx.query(
        `UPDATE assignments
         SET status = 'cancelled', cancelled_at = now(), fee_applies = $1,
             business_minutes_notice = $2, fee_cents = $3
         WHERE id = $4`,
        [decision.fee_applies, decision.business_minutes_notice, decision.fee_cents, record.id],
      );
      const cancelled = await findAssignmentById(tx, record.id);
      await tx.query(
        "INSERT INTO audit_entries (kind, assignment_id, actor_id, detail) VALUES ('cancellation_decision', $1, $2, $3)",
        [record.id, ctx.session.user.id, JSON.stringify(decision)],
      );
      if (decision.fee_applies) {
        await markBillable(tx, cancelled);
      }
      await enqueueCancellationNotices(
        tx,
        cancelled,
        decision.fee_applies,
        decision.fee_cents,
        holderEmails,
      );
      const finalRecord = await findAssignmentById(tx, record.id);
      return { status: 200, body: viewAs(finalRecord, viewer) };
    });
  },
};

const myOffers: Route = {
  method: 'GET',
  pattern: '/api/offers',
  body: 'none',
  auth: true,
  handler: async (ctx): Promise<Reply> => {
    requireRole(ctx, ['interpreter']);
    const viewer = viewerOf(ctx.session);
    const records = await queryAssignments(pool, {
      languages: viewer.languages,
      statuses: ['released', 'partially_covered'],
      startsAfter: new Date(),
    });
    const visible = records.filter((record) => record.seats.every((seat) => seat.holder_id !== viewer.id));
    return { status: 200, body: { offers: visible.map((record) => viewAs(record, viewer)) } };
  },
};

const mySeats: Route = {
  method: 'GET',
  pattern: '/api/my-seats',
  body: 'none',
  auth: true,
  handler: async (ctx): Promise<Reply> => {
    requireRole(ctx, ['interpreter']);
    const viewer = viewerOf(ctx.session);
    const records = await queryAssignments(pool, { heldBy: viewer.id });
    return { status: 200, body: { assignments: records.map((record) => viewAs(record, viewer)) } };
  },
};

export const assignmentRoutes = [
  createAssignment,
  listAssignments,
  myOffers,
  mySeats,
  getAssignment,
  patchAssignment,
  releaseAssignment,
  cancellationQuote,
  cancelAssignment,
];
