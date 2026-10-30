import { createHash } from 'node:crypto';
import {
  findAssignmentByNumber,
  findAssignments,
  loadAssignmentInTransaction,
  lockAssignmentByNumber,
} from '../../db/assignments.js';
import { query, withTransaction, type Transaction } from '../../db/pool.js';
import { listRateEntries, listRateEntriesIn } from '../../db/rateCards.js';
import { canCancel, canChangeTime, canRelease, seatCountFor } from '../../domain/assignment.js';
import { cancellationDecision, hasEnoughNotice } from '../../domain/cancellation.js';
import {
  validateAssignmentInput,
  type AssignmentInput,
} from '../../domain/requestInput.js';
import type { AssignmentRecord } from '../../domain/types.js';
import { assignmentView } from '../../domain/views.js';
import { enqueueEmails } from '../../services/mail.js';
import { cancellationNotices, changeNotices, offerNotices } from '../../services/notifications.js';
import { fail } from '../errors.js';
import type { Route } from '../router.js';

async function languageCodes(): Promise<string[]> {
  const rows = await query<{ code: string }>('select code from languages order by seed_order');
  return rows.map((row) => row.code);
}

async function reload(number: string): Promise<AssignmentRecord> {
  const record = await findAssignmentByNumber(number);
  if (record === null) throw new Error(`Assignment ${number} is missing`);
  return record;
}

function idempotencyKeyOf(raw: string | string[] | undefined): string {
  const key = typeof raw === 'string' ? raw : null;
  if (key === null || key.length === 0 || key.length > 100 || !/^[\x20-\x7e]+$/.test(key)) {
    fail('idempotency_key_required');
  }
  return key;
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
      left < right ? -1 : 1,
    );
    return entries.map(([key, inner]) => [key, canonical(inner)]);
  }
  return value;
}

function fingerprintOf(body: Record<string, unknown>): string {
  return createHash('sha256').update(JSON.stringify(canonical(body))).digest('hex');
}

function holderIdsOf(assignment: AssignmentRecord): string[] {
  return assignment.seats.flatMap((seat) => (seat.holderId === null ? [] : [seat.holderId]));
}

function inputOf(assignment: AssignmentRecord): AssignmentInput {
  return {
    languageCode: assignment.languageCode,
    setting: assignment.setting,
    startAt: assignment.startAt,
    durationMinutes: assignment.durationMinutes,
    streetAddress: assignment.streetAddress,
    city: assignment.city,
    patientInitials: assignment.patientInitials,
    medicalNotes: assignment.medicalNotes,
  };
}

async function freeSeatsForNewTime(
  tx: Transaction,
  assignment: AssignmentRecord,
  seatCount: number,
): Promise<string[]> {
  const freed = holderIdsOf(assignment);
  await tx.query(
    `update seat_holds set ended_at = now(), outcome = 'freed_by_change'
     where assignment_id = $1 and ended_at is null`,
    [assignment.id],
  );
  await tx.query(
    `update seats set status = 'open', holder_id = null where assignment_id = $1`,
    [assignment.id],
  );
  await tx.query('delete from seats where assignment_id = $1 and seat > $2', [
    assignment.id,
    seatCount,
  ]);
  for (let seat = 1; seat <= seatCount; seat += 1) {
    await tx.query(
      `insert into seats (assignment_id, seat, status) values ($1, $2, 'open')
       on conflict (assignment_id, seat) do nothing`,
      [assignment.id, seat],
    );
  }
  return freed;
}

export const assignmentRoutes: Route[] = [
  {
    kind: 'session',
    method: 'POST',
    path: '/api/assignments',
    body: 'json',
    roles: ['scheduler'],
    async handler(ctx) {
      const key = idempotencyKeyOf(ctx.headers['idempotency-key']);
      const fingerprint = fingerprintOf(ctx.json);
      const codes = await languageCodes();
      const orgCode = ctx.user.orgCode;
      if (orgCode === null) fail('forbidden');

      const outcome = await withTransaction(async (tx) => {
        const claimed = await tx.query<{ key: string }>(
          `insert into idempotency_keys (user_id, key, fingerprint) values ($1, $2, $3)
           on conflict (user_id, key) do nothing returning key`,
          [ctx.user.id, key, fingerprint],
        );
        if (claimed.length === 0) {
          const stored = await tx.queryOne<{ fingerprint: string; response_body: unknown }>(
            'select fingerprint, response_body from idempotency_keys where user_id = $1 and key = $2',
            [ctx.user.id, key],
          );
          if (stored === null || stored.fingerprint !== fingerprint) fail('idempotency_conflict');
          return { replay: true, body: stored.response_body };
        }

        const input = validateAssignmentInput(ctx.json, {
          languageCodes: codes,
          now: new Date(),
          base: null,
        });
        const seatCount = seatCountFor(input.languageCode, input.durationMinutes);
        const created = await tx.queryOne<{ id: number }>(
          `insert into assignments
             (number, org_code, scheduler_id, language_code, setting, start_at, duration_minutes,
              street_address, city, patient_initials, medical_notes, status, seat_count)
           values ('A-' || nextval('assignment_number_seq'), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'draft', $11)
           returning id`,
          [
            orgCode,
            ctx.user.id,
            input.languageCode,
            input.setting,
            input.startAt,
            input.durationMinutes,
            input.streetAddress,
            input.city,
            input.patientInitials,
            input.medicalNotes,
            seatCount,
          ],
        );
        if (created === null) throw new Error('Assignment insert returned no row');
        for (let seat = 1; seat <= seatCount; seat += 1) {
          await tx.query(`insert into seats (assignment_id, seat, status) values ($1, $2, 'open')`, [
            created.id,
            seat,
          ]);
        }
        const record = await loadAssignmentInTransaction(tx, created.id);
        const view = assignmentView(record, 'organisation');
        await tx.query(
          'update idempotency_keys set response_body = $1::jsonb where user_id = $2 and key = $3',
          [JSON.stringify(view), ctx.user.id, key],
        );
        return { replay: false, body: view };
      });

      return {
        status: 201,
        json: outcome.body,
        ...(outcome.replay ? { headers: { 'Idempotent-Replay': 'true' } } : {}),
      };
    },
  },
  {
    kind: 'session',
    method: 'GET',
    path: '/api/assignments',
    body: 'none',
    roles: ['scheduler', 'org_admin', 'dispatcher', 'billing_lead'],
    async handler(ctx) {
      const search = ctx.url.searchParams.get('q');
      const clauses: string[] = [];
      const values: (string | number)[] = [];
      if (ctx.user.role === 'scheduler' || ctx.user.role === 'org_admin') {
        values.push(ctx.user.orgCode ?? '');
        clauses.push(`a.org_code = $${values.length}`);
      }
      if (search !== null && search.trim() !== '') {
        values.push(`%${search.trim()}%`);
        clauses.push(`(a.number ilike $${values.length} or a.city ilike $${values.length})`);
      }
      const records = await findAssignments(
        clauses.length === 0 ? 'true' : clauses.join(' and '),
        values,
      );
      const kind = ctx.user.role === 'scheduler' || ctx.user.role === 'org_admin' ? 'organisation' : 'staff';
      return { status: 200, json: { assignments: records.map((record) => assignmentView(record, kind)) } };
    },
  },
  {
    kind: 'assignment',
    method: 'GET',
    path: '/api/assignments/:number',
    body: 'none',
    async handler(ctx) {
      return { status: 200, json: ctx.view() };
    },
  },
  {
    kind: 'assignment',
    method: 'PATCH',
    path: '/api/assignments/:number',
    body: 'json',
    roles: ['scheduler'],
    async handler(ctx) {
      const codes = await languageCodes();
      const changesTime =
        ctx.json['start_at'] !== undefined || ctx.json['duration_minutes'] !== undefined;

      await withTransaction(async (tx) => {
        const locked = await lockAssignmentByNumber(tx, ctx.assignment.number);
        if (locked === null || !canChangeTime(locked.status)) fail('invalid_transition');
        const assignment = await loadAssignmentInTransaction(tx, locked.id);
        const now = new Date();
        if (changesTime && !hasEnoughNotice(assignment.startAt, now)) fail('late_change');

        const input = validateAssignmentInput(ctx.json, {
          languageCodes: codes,
          now,
          base: inputOf(assignment),
        });

        if (!changesTime) {
          await tx.query(
            'update assignments set street_address = $1, city = $2, medical_notes = $3 where id = $4',
            [input.streetAddress, input.city, input.medicalNotes, assignment.id],
          );
          return;
        }

        const seatCount = seatCountFor(input.languageCode, input.durationMinutes);
        const freed = await freeSeatsForNewTime(tx, assignment, seatCount);
        const rows = await tx.query<{ offer_round: number; change_round: number }>(
          `update assignments
           set start_at = $1, duration_minutes = $2, street_address = $3, city = $4,
               medical_notes = $5, seat_count = $6,
               status = case when status = 'draft' then 'draft' else 'released' end,
               offer_round = case when status = 'draft' then offer_round else offer_round + 1 end,
               change_round = change_round + 1
           where id = $7
           returning offer_round, change_round`,
          [
            input.startAt,
            input.durationMinutes,
            input.streetAddress,
            input.city,
            input.medicalNotes,
            seatCount,
            assignment.id,
          ],
        );
        const rounds = rows[0];
        if (rounds === undefined) throw new Error('Time change returned no row');
        const updated = await loadAssignmentInTransaction(tx, assignment.id);
        if (updated.status === 'released') {
          await enqueueEmails(tx, await offerNotices(tx, updated, rounds.offer_round));
        }
        await enqueueEmails(tx, await changeNotices(tx, updated, freed, rounds.change_round));
      });

      const record = await reload(ctx.assignment.number);
      return { status: 200, json: assignmentView(record, 'organisation') };
    },
  },
  {
    kind: 'assignment',
    method: 'POST',
    path: '/api/assignments/:number/release',
    body: 'json',
    roles: ['dispatcher'],
    async handler(ctx) {
      const offersSent = await withTransaction(async (tx) => {
        const locked = await lockAssignmentByNumber(tx, ctx.assignment.number);
        if (locked === null || !canRelease(locked.status)) fail('invalid_transition');
        const rows = await tx.query<{ offer_round: number }>(
          `update assignments set status = 'released', offer_round = offer_round + 1
           where id = $1 returning offer_round`,
          [locked.id],
        );
        const round = rows[0]?.offer_round;
        if (round === undefined) throw new Error('Release returned no row');
        const record = await loadAssignmentInTransaction(tx, locked.id);
        const notices = await offerNotices(tx, record, round);
        await enqueueEmails(tx, notices);
        return notices.length;
      });
      const record = await reload(ctx.assignment.number);
      return {
        status: 200,
        json: { assignment: assignmentView(record, 'staff'), offers_sent: offersSent },
      };
    },
  },
  {
    kind: 'assignment',
    method: 'GET',
    path: '/api/assignments/:number/cancellation-quote',
    body: 'none',
    roles: ['scheduler'],
    async handler(ctx) {
      if (!canCancel(ctx.assignment.status)) fail('invalid_transition');
      const rates = await listRateEntries(ctx.assignment.orgCode);
      const decision = cancellationDecision(ctx.assignment, rates, new Date());
      return {
        status: 200,
        json: {
          fee_applies: decision.feeApplies,
          business_minutes_notice: decision.businessMinutesNotice,
          fee_cents: decision.feeCents,
        },
      };
    },
  },
  {
    kind: 'assignment',
    method: 'POST',
    path: '/api/assignments/:number/cancel',
    body: 'json',
    roles: ['scheduler'],
    async handler(ctx) {
      await withTransaction(async (tx) => {
        const locked = await lockAssignmentByNumber(tx, ctx.assignment.number);
        if (locked === null || !canCancel(locked.status)) fail('invalid_transition');
        const assignment = await loadAssignmentInTransaction(tx, locked.id);
        const rates = await listRateEntriesIn(tx, assignment.orgCode);
        const decision = cancellationDecision(assignment, rates, new Date());
        const holders = holderIdsOf(assignment);
        await tx.query(
          `update assignments
           set status = 'cancelled', cancelled_at = now(), cancel_fee_applies = $1,
               cancel_business_minutes = $2, cancel_fee_cents = $3,
               billing_status = case when $1 then 'ready' else billing_status end
           where id = $4`,
          [decision.feeApplies, decision.businessMinutesNotice, decision.feeCents, assignment.id],
        );
        await tx.query(
          `update seat_holds set ended_at = now(), outcome = 'cancelled'
           where assignment_id = $1 and ended_at is null`,
          [assignment.id],
        );
        await tx.query(
          `insert into audit_log (actor_id, kind, assignment_id, detail)
           values ($1, 'cancellation_decision', $2, $3::jsonb)`,
          [
            ctx.user.id,
            assignment.id,
            JSON.stringify({
              fee_applies: decision.feeApplies,
              business_minutes_notice: decision.businessMinutesNotice,
              fee_cents: decision.feeCents,
            }),
          ],
        );
        await enqueueEmails(
          tx,
          await cancellationNotices(
            tx,
            assignment,
            holders,
            decision.feeApplies,
            decision.feeCents,
          ),
        );
      });
      const record = await reload(ctx.assignment.number);
      return { status: 200, json: assignmentView(record, 'organisation') };
    },
  },
];
