import { db, transact, type Queryable } from '../db.js';
import { ApiError, notFound } from '../http/errors.js';
import { json, type RouteContext, type RouteResult } from '../http/context.js';
import { route, type Route } from '../http/router.js';
import { agencyDateOf } from '../domain/agency-time.js';
import { credentialBadges, hasCredentialOnDate, windowsOverlap } from '../domain/eligibility.js';
import { derivedStatus } from '../../shared/staffing.js';
import { endsAt, mayReadRequest, projectSeats } from '../domain/projection.js';
import {
  hydrate,
  loadInterpreters,
  loadOneById,
  loadRequestRows,
  writeHistory,
} from '../store/requests.js';
import { queueEmails } from '../store/emails.js';
import { fullyStaffedEmail, seatWonEmail, type JobFacts } from '../mail/templates.js';
import { viewOf } from './common.js';
import { requireJsonContentType } from './validation.js';
import type { CredentialType, RequestView, SeatLabel, SeatStatus } from '../../shared/types.js';
import type { CredentialRecord } from '../domain/eligibility.js';

interface SeatLookupRow {
  seat_id: string;
  seat_label: SeatLabel;
  seat_status: SeatStatus;
  request_id: string;
}

async function lookupSeat(client: Queryable, seatId: string): Promise<SeatLookupRow | null> {
  const result = await client.query<SeatLookupRow>(
    `SELECT id AS seat_id, label AS seat_label, status AS seat_status, request_id FROM seats WHERE id = $1`,
    [seatId],
  );
  return result.rows[0] ?? null;
}

async function myCredentials(client: Queryable, interpreterId: string): Promise<CredentialRecord[]> {
  const result = await client.query<{
    credential_type: CredentialType;
    verified: boolean;
    expires_on: string | null;
  }>(
    `SELECT credential_type, verified, to_char(expires_on, 'YYYY-MM-DD') AS expires_on
       FROM credentials WHERE interpreter_id = $1`,
    [interpreterId],
  );
  return result.rows;
}

async function confirmedWindows(
  client: Queryable,
  interpreterId: string,
): Promise<{ starts_at: Date; ends_at: Date }[]> {
  const result = await client.query<{ starts_at: Date; duration_minutes: number }>(
    `SELECT r.starts_at, r.duration_minutes
       FROM seats s JOIN requests r ON r.id = s.request_id
      WHERE s.interpreter_id = $1 AND s.status = 'confirmed'
        AND r.status NOT IN ('cancelled_early', 'cancelled_late')`,
    [interpreterId],
  );
  return result.rows.map((row) => ({
    starts_at: row.starts_at,
    ends_at: endsAt(row.starts_at, row.duration_minutes),
  }));
}

async function openSeats(ctx: RouteContext): Promise<RouteResult> {
  const actor = ctx.gate('interpreter');
  const now = new Date();
  const rows = await loadRequestRows(`r.status IN ('submitted', 'half-staffed')`, []);
  const loaded = await hydrate(rows);
  const credentials = await myCredentials(db, actor.id);
  const held = await confirmedWindows(db, actor.id);

  const openSeatList: { seat_id: string; seat_label: SeatLabel; request: RequestView }[] = [];
  for (const entry of loaded) {
    const window = {
      starts_at: entry.row.starts_at,
      ends_at: endsAt(entry.row.starts_at, entry.row.duration_minutes),
    };
    if (!hasCredentialOnDate(credentials, entry.row.required_credential, agencyDateOf(entry.row.starts_at))) {
      continue;
    }
    if (held.some((other) => windowsOverlap(window, other))) continue;
    const view = await viewOf(actor, entry, now);
    for (const seat of entry.seats) {
      if (seat.status !== 'open') continue;
      openSeatList.push({ seat_id: seat.id, seat_label: seat.label, request: view });
    }
  }
  return json({ open_seats: openSeatList });
}

async function assignments(ctx: RouteContext): Promise<RouteResult> {
  const actor = ctx.gate('interpreter');
  const now = new Date();
  const rows = await loadRequestRows(
    `EXISTS (SELECT 1 FROM seats s WHERE s.request_id = r.id AND s.status = 'confirmed' AND s.interpreter_id = $1)`,
    [actor.id],
  );
  const loaded = await hydrate(rows);
  const list: { seat_id: string; seat_label: SeatLabel; request: RequestView }[] = [];
  for (const entry of loaded) {
    const view = await viewOf(actor, entry, now);
    for (const seat of entry.seats) {
      if (seat.status === 'confirmed' && seat.interpreter_id === actor.id) {
        list.push({ seat_id: seat.id, seat_label: seat.label, request: view });
      }
    }
  }
  return json({ assignments: list });
}

function factsOf(row: {
  reference: string;
  setting: JobFacts['setting'];
  required_credential: CredentialType;
  starts_at: Date;
  duration_minutes: number;
  city: string;
}): JobFacts {
  return {
    reference: row.reference,
    setting: row.setting,
    required_credential: row.required_credential,
    starts_at: row.starts_at,
    ends_at: endsAt(row.starts_at, row.duration_minutes),
    city: row.city,
  };
}

async function claimSeat(ctx: RouteContext): Promise<RouteResult> {
  const actor = ctx.requireActor();
  const seatId = ctx.param('id');
  const seat = await lookupSeat(db, seatId);

  // Precedence step 3: a claim on an already-confirmed seat answers seat_taken first.
  if (actor.role === 'interpreter' && seat !== null && seat.seat_status === 'confirmed') {
    await recordClaimLost(seat.request_id, actor.display_name, 'seat_taken');
    throw new ApiError('seat_taken');
  }

  if (seat === null) throw notFound();
  const loaded = await loadOneById(seat.request_id);
  if (loaded === null || !mayReadRequest(actor, loaded)) throw notFound();
  ctx.gate('interpreter');
  requireJsonContentType(ctx.hasWrongContentType());

  const now = new Date();
  try {
    const result = await transact(async (client) => {
      await client.query(`SELECT id FROM people WHERE id = $1 FOR UPDATE`, [actor.id]);
      const current = await client.query<{
        status: SeatStatus;
        label: SeatLabel;
        request_id: string;
      }>(`SELECT status, label, request_id FROM seats WHERE id = $1`, [seatId]);
      const seatRow = current.rows[0];
      if (seatRow === undefined) throw notFound();
      const request = await loadOneById(seatRow.request_id, client);
      if (request === null) throw notFound();

      // A seat confirmed while this claim was in flight answers seat_taken ahead of the
      // lifecycle check, even though the winning claim has just made the request staffed.
      if (seatRow.status === 'confirmed') throw new ApiError('seat_taken');
      if (request.row.status !== 'submitted' && request.row.status !== 'half-staffed') {
        throw new ApiError('invalid_transition');
      }

      const credentials = await myCredentials(client, actor.id);
      const jobDate = agencyDateOf(request.row.starts_at);
      if (!hasCredentialOnDate(credentials, request.row.required_credential, jobDate)) {
        throw new ApiError('credential_invalid');
      }

      const window = {
        starts_at: request.row.starts_at,
        ends_at: endsAt(request.row.starts_at, request.row.duration_minutes),
      };
      const held = await confirmedWindows(client, actor.id);
      if (held.some((other) => windowsOverlap(window, other))) {
        throw new ApiError('schedule_conflict');
      }

      const claimed = await client.query<{ id: string }>(
        `UPDATE seats SET status = 'confirmed', interpreter_id = $2, confirmed_at = now()
          WHERE id = $1 AND status = 'open' RETURNING id`,
        [seatId, actor.id],
      );
      if (claimed.rows.length === 0) throw new ApiError('seat_taken');

      const after = await loadOneById(seatRow.request_id, client);
      if (after === null) throw notFound();
      const status = derivedStatus(request.row.status, after.seats);
      await client.query(`UPDATE requests SET status = $2 WHERE id = $1`, [after.row.id, status]);
      await writeHistory(
        client,
        after.row.id,
        actor.display_name,
        'claim_won',
        `seat ${seatRow.label}`,
      );

      const facts = factsOf(after.row);
      const otherSeat = after.seats.find((entry) => entry.label !== seatRow.label);
      const teammateId =
        otherSeat !== undefined && otherSeat.status === 'confirmed' ? otherSeat.interpreter_id : null;
      const people = await loadInterpreters(
        [actor.id, ...(teammateId === null ? [] : [teammateId])],
        client,
      );
      const teammate = teammateId === null ? null : (people.get(teammateId) ?? null);
      const emails = [
        seatWonEmail(
          facts,
          seatRow.label,
          actor.email,
          teammate === null ? null : { display_name: teammate.display_name },
          otherSeat?.label ?? null,
        ),
      ];
      if (teammate !== null) {
        emails.push(
          seatWonEmail(
            facts,
            seatRow.label,
            teammate.email,
            { display_name: actor.display_name },
            seatRow.label,
          ),
        );
      }

      if (status === 'staffed') {
        const scheduler = await client.query<{ email: string }>(
          `SELECT email FROM people WHERE role = 'client_scheduler' AND organisation_id = $1`,
          [after.row.organisation_id],
        );
        const today = agencyDateOf(now);
        const seatLines = after.seats
          .filter((entry) => entry.interpreter_id !== null)
          .map((entry) => {
            const person = people.get(entry.interpreter_id as string);
            return {
              label: entry.label,
              display_name: person?.display_name ?? '',
              credentials: person === undefined ? [] : credentialBadges(person.credentials, today),
            };
          })
          .sort((left, right) => left.label.localeCompare(right.label));
        for (const row of scheduler.rows) {
          emails.push(fullyStaffedEmail(facts, row.email, seatLines));
        }
      }
      await queueEmails(client, emails);

      return {
        seat:
          projectSeats(actor, after, agencyDateOf(now)).find((entry) => entry.id === seatId) ?? null,
        request: await viewOf(actor, after, now),
      };
    });
    return json(result);
  } catch (error) {
    if (error instanceof ApiError && CLAIM_REFUSALS.includes(error.code)) {
      await recordClaimLost(seat.request_id, actor.display_name, error.code);
    }
    throw error;
  }
}

const CLAIM_REFUSALS: readonly string[] = [
  'invalid_transition',
  'seat_taken',
  'credential_invalid',
  'schedule_conflict',
];

async function recordClaimLost(requestId: string, actorName: string, code: string): Promise<void> {
  await transact(async (client) => {
    await writeHistory(client, requestId, actorName, 'claim_lost', code);
  });
}

export const seatRoutes: Route[] = [
  route('GET', '/api/open-seats', openSeats),
  route('GET', '/api/assignments', assignments),
  route('POST', '/api/seats/:id/claim', claimSeat),
];
