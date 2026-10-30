import { randomBytes } from 'node:crypto';
import {
  findAssignmentByNumber,
  findAssignments,
  loadAssignmentInTransaction,
  lockAssignmentByNumber,
} from '../../db/assignments.js';
import { query, queryOne, withTransaction } from '../../db/pool.js';
import {
  canClaim,
  canGiveBack,
  canVerify,
  coverageStatus,
  endOf,
  statusAfterVerification,
} from '../../domain/assignment.js';
import type { AssignmentRecord } from '../../domain/types.js';
import { assignmentView } from '../../domain/views.js';
import { enqueueEmails } from '../../services/mail.js';
import { claimNotice, coverageNotice } from '../../services/notifications.js';
import { getObject, putObject, StorageUnavailable } from '../../services/storage.js';
import { fail } from '../errors.js';
import type { Route } from '../router.js';
import type { MultipartBody, MultipartFile } from '../body.js';
import { integerFromText } from '../validation.js';

const VERIFICATION_LINK_SECONDS = 60;

interface FormFormat {
  contentType: string;
  extension: string;
  matches: (data: Buffer) => boolean;
}

const FORM_TYPES: FormFormat[] = [
  {
    contentType: 'application/pdf',
    extension: 'pdf',
    matches: (data) => data.subarray(0, 5).toString('latin1') === '%PDF-',
  },
  {
    contentType: 'image/jpeg',
    extension: 'jpg',
    matches: (data) => data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff,
  },
  {
    contentType: 'image/png',
    extension: 'png',
    matches: (data) =>
      data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  },
];

async function reload(number: string): Promise<AssignmentRecord> {
  const record = await findAssignmentByNumber(number);
  if (record === null) throw new Error(`Assignment ${number} is missing`);
  return record;
}

interface VerificationUpload {
  actualMinutes: number;
  roundTripMiles: number;
  file: MultipartFile;
  format: FormFormat;
}

function parseVerificationUpload(multipart: MultipartBody): VerificationUpload {
  const errors: Record<string, string> = {};
  const actualMinutes = integerFromText(multipart.fields.get('actual_minutes'));
  const roundTripMiles = integerFromText(multipart.fields.get('round_trip_miles'));
  const file = multipart.files.get('form');
  const declared = (file?.contentType ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  const format = FORM_TYPES.find((candidate) => candidate.contentType === declared);

  if (actualMinutes === null || actualMinutes < 1 || actualMinutes > 960) {
    errors['actual_minutes'] = 'Enter the minutes worked, from 1 to 960.';
  }
  if (roundTripMiles === null || roundTripMiles < 0 || roundTripMiles > 1000) {
    errors['round_trip_miles'] = 'Enter round-trip miles, from 0 to 1,000.';
  }
  if (file === undefined || file.data.length === 0) {
    errors['form'] = 'Attach the signed verification form.';
  } else if (format === undefined || !format.matches(file.data)) {
    errors['form'] = 'Upload a PDF, JPEG or PNG file.';
  }

  if (
    actualMinutes === null ||
    roundTripMiles === null ||
    file === undefined ||
    format === undefined ||
    Object.keys(errors).length > 0
  ) {
    fail('validation', errors);
  }
  return { actualMinutes, roundTripMiles, file, format };
}

export const seatRoutes: Route[] = [
  {
    kind: 'session',
    method: 'GET',
    path: '/api/offers',
    body: 'none',
    roles: ['interpreter'],
    async handler(ctx) {
      const records = await findAssignments(
        `a.status in ('released', 'partially_covered')
         and a.language_code = any($1::text[]) and a.start_at > now()`,
        [`{${ctx.user.languages.join(',')}}`],
      );
      return { status: 200, json: { offers: records.map((record) => assignmentView(record, 'offer')) } };
    },
  },
  {
    kind: 'session',
    method: 'GET',
    path: '/api/my-seats',
    body: 'none',
    roles: ['interpreter'],
    async handler(ctx) {
      const records = await findAssignments(
        'a.id in (select assignment_id from seats where holder_id = $1)',
        [ctx.user.id],
      );
      return {
        status: 200,
        json: { assignments: records.map((record) => assignmentView(record, 'holder')) },
      };
    },
  },
  {
    kind: 'seat',
    method: 'POST',
    path: '/api/assignments/:number/seats/:seat/claim',
    body: 'json',
    roles: ['interpreter'],
    async handler(ctx) {
      await withTransaction(async (tx) => {
        // One interpreter's claims are serialised on their own row, then on the
        // assignment, so two races cannot leave two holds.
        await tx.query('select id from users where id = $1 for update', [ctx.user.id]);
        const locked = await lockAssignmentByNumber(tx, ctx.assignment.number);
        if (locked === null || !canClaim(locked.status)) fail('seat_taken');
        const assignment = await loadAssignmentInTransaction(tx, locked.id);
        const seat = assignment.seats.find((candidate) => candidate.seat === ctx.seat);
        if (seat === undefined || seat.status !== 'open') fail('seat_taken');
        if (assignment.seats.some((candidate) => candidate.holderId === ctx.user.id)) {
          fail('already_holding');
        }
        const overlap = await tx.queryOne<{ one: number }>(
          `select 1 as one from seats s
           join assignments a on a.id = s.assignment_id
           where s.holder_id = $1 and a.id <> $2 and a.status <> 'cancelled'
             and (a.start_at, a.start_at + make_interval(mins => a.duration_minutes))
                 overlaps ($3::timestamptz, $4::timestamptz)
           limit 1`,
          [ctx.user.id, assignment.id, assignment.startAt, endOf(assignment)],
        );
        if (overlap !== null) fail('calendar_conflict');

        await tx.query(
          `update seats set status = 'held', holder_id = $1 where assignment_id = $2 and seat = $3`,
          [ctx.user.id, assignment.id, ctx.seat],
        );
        const holds = await tx.query<{ id: number }>(
          `insert into seat_holds (assignment_id, seat, interpreter_id) values ($1, $2, $3) returning id`,
          [assignment.id, ctx.seat, ctx.user.id],
        );
        const holdId = holds[0]?.id;
        if (holdId === undefined) throw new Error('Hold insert returned no row');

        const seatsAfter = assignment.seats.map((candidate) =>
          candidate.seat === ctx.seat ? { status: 'held' as const } : { status: candidate.status },
        );
        const status = coverageStatus(seatsAfter);
        const rows = await tx.query<{ coverage_round: number }>(
          `update assignments set status = $1,
             coverage_round = case when $1 = 'covered' then coverage_round + 1 else coverage_round end
           where id = $2 returning coverage_round`,
          [status, assignment.id],
        );
        const updated = await loadAssignmentInTransaction(tx, assignment.id);
        await enqueueEmails(
          tx,
          await claimNotice(tx, updated, ctx.seat, holdId, ctx.user.id),
        );
        if (status === 'covered') {
          const round = rows[0]?.coverage_round ?? 0;
          await enqueueEmails(tx, await coverageNotice(tx, updated, round));
        }
      });
      const record = await reload(ctx.assignment.number);
      return { status: 200, json: assignmentView(record, 'holder') };
    },
  },
  {
    kind: 'seat',
    method: 'POST',
    path: '/api/assignments/:number/seats/:seat/give-back',
    body: 'json',
    roles: ['interpreter'],
    async handler(ctx) {
      const held = ctx.assignment.seats.find((candidate) => candidate.seat === ctx.seat);
      if (held === undefined || held.holderId !== ctx.user.id) fail('forbidden');
      await withTransaction(async (tx) => {
        const locked = await lockAssignmentByNumber(tx, ctx.assignment.number);
        if (locked === null || !canGiveBack(locked.status)) fail('invalid_transition');
        const assignment = await loadAssignmentInTransaction(tx, locked.id);
        const seat = assignment.seats.find((candidate) => candidate.seat === ctx.seat);
        if (seat === undefined || seat.status !== 'held' || seat.holderId !== ctx.user.id) {
          fail('invalid_transition');
        }
        await tx.query(
          `update seats set status = 'open', holder_id = null where assignment_id = $1 and seat = $2`,
          [assignment.id, ctx.seat],
        );
        await tx.query(
          `update seat_holds set ended_at = now(), outcome = 'released_back'
           where assignment_id = $1 and seat = $2 and ended_at is null`,
          [assignment.id, ctx.seat],
        );
        const seatsAfter = assignment.seats.map((candidate) =>
          candidate.seat === ctx.seat ? { status: 'open' as const } : { status: candidate.status },
        );
        await tx.query('update assignments set status = $1 where id = $2', [
          coverageStatus(seatsAfter),
          assignment.id,
        ]);
      });
      const record = await reload(ctx.assignment.number);
      return { status: 200, json: assignmentView(record, 'offer') };
    },
  },
  {
    kind: 'upload',
    method: 'POST',
    path: '/api/assignments/:number/seats/:seat/verification',
    roles: ['interpreter'],
    async handler(ctx) {
      const seat = ctx.assignment.seats.find((candidate) => candidate.seat === ctx.seat);
      if (seat === undefined || seat.holderId !== ctx.user.id) fail('forbidden');
      const stored = await queryOne<{ seat: number }>(
        'select seat from verifications where assignment_id = $1 and seat = $2',
        [ctx.assignment.id, ctx.seat],
      );
      if (stored !== null) fail('already_verified');
      if (!canVerify(ctx.assignment.status) || seat.status !== 'held') fail('invalid_transition');

      const { actualMinutes, roundTripMiles, file, format } = parseVerificationUpload(ctx.multipart);

      const key = `verifications/${ctx.assignment.number}/seat-${ctx.seat}/${randomBytes(16).toString('hex')}.${format.extension}`;
      try {
        await putObject(key, file.data, format.contentType);
      } catch (error) {
        if (error instanceof StorageUnavailable) fail('storage_unavailable');
        throw error;
      }

      await withTransaction(async (tx) => {
        const locked = await lockAssignmentByNumber(tx, ctx.assignment.number);
        if (locked === null || !canVerify(locked.status)) fail('invalid_transition');
        const assignment = await loadAssignmentInTransaction(tx, locked.id);
        const current = assignment.seats.find((candidate) => candidate.seat === ctx.seat);
        if (current === undefined || current.status !== 'held' || current.holderId !== ctx.user.id) {
          fail('invalid_transition');
        }
        await tx.query(
          `insert into verifications
             (assignment_id, seat, interpreter_id, actual_minutes, round_trip_miles, object_key, content_type, byte_size)
           values ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            assignment.id,
            ctx.seat,
            ctx.user.id,
            actualMinutes,
            roundTripMiles,
            key,
            format.contentType,
            file.data.length,
          ],
        );
        await tx.query(
          `update seats set status = 'served' where assignment_id = $1 and seat = $2`,
          [assignment.id, ctx.seat],
        );
        await tx.query(
          `update seat_holds set ended_at = now(), outcome = 'served'
           where assignment_id = $1 and seat = $2 and ended_at is null`,
          [assignment.id, ctx.seat],
        );
        const seatsAfter = assignment.seats.map((candidate) =>
          candidate.seat === ctx.seat ? { status: 'served' as const } : { status: candidate.status },
        );
        const status = statusAfterVerification(seatsAfter);
        await tx.query(
          `update assignments set status = $1,
             billing_status = case when $1 = 'verified' then 'ready' else billing_status end
           where id = $2`,
          [status, assignment.id],
        );
      });

      const record = await reload(ctx.assignment.number);
      return { status: 201, json: assignmentView(record, 'holder') };
    },
  },
  {
    kind: 'seat',
    method: 'GET',
    path: '/api/assignments/:number/seats/:seat/verification-link',
    body: 'none',
    async handler(ctx) {
      const verification = await queryOne<{ object_key: string; content_type: string }>(
        'select object_key, content_type from verifications where assignment_id = $1 and seat = $2',
        [ctx.assignment.id, ctx.seat],
      );
      if (verification === null) fail('not_found');
      const seat = ctx.assignment.seats.find((candidate) => candidate.seat === ctx.seat);
      if (ctx.user.role === 'interpreter' && seat?.holderId !== ctx.user.id) fail('forbidden');

      const token = randomBytes(24).toString('hex');
      await query(
        `insert into file_tokens (token, session_token, object_key, content_type, expires_at)
         values ($1, $2, $3, $4, now() + ($5 || ' seconds')::interval)`,
        [
          token,
          ctx.sessionToken,
          verification.object_key,
          verification.content_type,
          String(VERIFICATION_LINK_SECONDS),
        ],
      );
      return {
        status: 200,
        json: { url: `/files/${token}`, expires_in_seconds: VERIFICATION_LINK_SECONDS },
      };
    },
  },
  {
    kind: 'session',
    method: 'GET',
    path: '/files/:token',
    body: 'none',
    async handler(ctx) {
      const row = await queryOne<{ object_key: string; content_type: string }>(
        `select object_key, content_type from file_tokens
         where token = $1 and session_token = $2 and expires_at > now()`,
        [ctx.params['token'] ?? '', ctx.sessionToken],
      );
      if (row === null) fail('not_found');
      try {
        const data = await getObject(row.object_key);
        return {
          status: 200,
          body: data,
          contentType: row.content_type,
          headers: {
            'Content-Disposition': 'attachment',
            'Cache-Control': 'no-store',
          },
        };
      } catch (error) {
        if (error instanceof StorageUnavailable) fail('storage_unavailable');
        throw error;
      }
    },
  },
];
