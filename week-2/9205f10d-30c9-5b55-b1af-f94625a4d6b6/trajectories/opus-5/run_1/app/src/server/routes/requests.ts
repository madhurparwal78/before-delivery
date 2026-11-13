import { transact, type Queryable, type QueryValue } from '../db.js';
import { ApiError, validationError } from '../http/errors.js';
import { json, type RouteContext, type RouteResult } from '../http/context.js';
import { route, type Route } from '../http/router.js';
import {
  agencyDateOf,
  parseIsoDate,
  resolveLocalForgiving,
  weekStartLocal,
} from '../domain/agency-time.js';
import { endsAt } from '../domain/projection.js';
import {
  DEFAULT_ROTATION_MINUTES,
  defaultTeamSize,
  derivedStatus,
  seatLabelsForTeamSize,
} from '../../shared/staffing.js';
import {
  hasCredentialOnDate,
  windowsOverlap,
  type CredentialRecord,
} from '../domain/eligibility.js';
import {
  hydrate,
  loadRequestRows,
  nextReference,
  writeHistory,
  type SeatRow,
} from '../store/requests.js';
import { queueEmails } from '../store/emails.js';
import { openSeatEmail } from '../mail/templates.js';
import { readableRequest, viewById, viewOf } from './common.js';
import {
  DEFAULT_CREDENTIAL_BY_SETTING,
  readActualMinutes,
  readRequestFields,
  readStaffingFields,
  requireJsonContentType,
} from './validation.js';
import { newId } from '../ids.js';
import type { CredentialType, RequestStatus, SeatLabel, SeatStatus } from '../../shared/types.js';

const SEAT_LABELS: readonly SeatLabel[] = ['A', 'B'];

const CLAIMABLE: readonly RequestStatus[] = ['submitted', 'half-staffed'];
const STAFFABLE: readonly RequestStatus[] = ['submitted', 'half-staffed', 'staffed'];
const COMPLETABLE: readonly RequestStatus[] = ['half-staffed', 'staffed'];

function requireStatus(actual: RequestStatus, allowed: readonly RequestStatus[]): void {
  if (!allowed.includes(actual)) throw new ApiError('invalid_transition');
}

async function listRequests(ctx: RouteContext): Promise<RouteResult> {
  const actor = ctx.gate('coordinator', 'billing_admin', 'client_scheduler');
  const now = new Date();
  const clauses: string[] = ['1 = 1'];
  const values: QueryValue[] = [];

  if (actor.role === 'client_scheduler') {
    values.push(actor.organisation?.id ?? '');
    clauses.push(`r.organisation_id = $${values.length}`);
  }

  const week = ctx.queryParam('week');
  if (week !== null) {
    const date = parseIsoDate(week);
    if (date === null) throw validationError({ week: 'Enter the week as YYYY-MM-DD.' });
    const monday = weekStartLocal(date);
    const start = resolveLocalForgiving(monday);
    const nextMonday = weekStartLocal({ year: monday.year, month: monday.month, day: monday.day + 7 });
    const end = resolveLocalForgiving(nextMonday);
    values.push(start);
    clauses.push(`r.starts_at >= $${values.length}`);
    values.push(end);
    clauses.push(`r.starts_at < $${values.length}`);
  }

  const status = ctx.queryParam('status');
  if (status !== null && status !== '') {
    values.push(status.split(',').map((part) => part.trim()));
    clauses.push(`r.status = ANY($${values.length}::text[])`);
  }

  const search = ctx.queryParam('q');
  if (search !== null && search !== '') {
    values.push(`%${search}%`);
    clauses.push(`(r.reference ILIKE $${values.length} OR r.consumer_name ILIKE $${values.length})`);
  }

  const rows = await loadRequestRows(clauses.join(' AND '), values);
  const loaded = await hydrate(rows);
  const requests = await Promise.all(loaded.map((entry) => viewOf(actor, entry, now)));
  return json({ requests });
}

async function createRequest(ctx: RouteContext): Promise<RouteResult> {
  const actor = ctx.gate('client_scheduler');
  requireJsonContentType(ctx.hasWrongContentType());
  const now = new Date();
  const input = readRequestFields(ctx.body(), 'create', now);
  const setting = input.setting as NonNullable<typeof input.setting>;
  const startsAt = input.starts_at as Date;
  const duration = input.duration_minutes as number;
  const id = newId('req');

  await transact(async (client) => {
    const reference = await nextReference(client);
    await client.query(
      `INSERT INTO requests (id, reference, organisation_id, setting, required_credential, starts_at,
          duration_minutes, city, location_address, consumer_name, notes, status, team_size, rotation_minutes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'draft',$12,$13)`,
      [
        id,
        reference,
        actor.organisation?.id ?? '',
        setting,
        input.required_credential ?? DEFAULT_CREDENTIAL_BY_SETTING[setting],
        startsAt,
        duration,
        input.city as string,
        input.location_address as string,
        input.consumer_name as string,
        input.notes ?? '',
        defaultTeamSize(duration),
        DEFAULT_ROTATION_MINUTES,
      ],
    );
    await writeHistory(client, id, actor.display_name, 'created', reference);
  });

  return json(await viewById(actor, id, now), 201);
}

async function getRequest(ctx: RouteContext): Promise<RouteResult> {
  const actor = ctx.requireActor();
  const loaded = await readableRequest(actor, ctx.param('id'));
  return json(await viewOf(actor, loaded, new Date()));
}

async function patchRequest(ctx: RouteContext): Promise<RouteResult> {
  const actor = ctx.requireActor();
  const loaded = await readableRequest(actor, ctx.param('id'));
  ctx.gate('client_scheduler');
  requireStatus(loaded.row.status, ['draft']);
  requireJsonContentType(ctx.hasWrongContentType());
  const now = new Date();
  const input = readRequestFields(ctx.body(), 'edit', now);

  const updates: string[] = [];
  const values: QueryValue[] = [loaded.row.id];
  const set = (column: string, value: QueryValue): void => {
    values.push(value);
    updates.push(`${column} = $${values.length}`);
  };
  if (input.setting !== undefined) {
    set('setting', input.setting);
    if (input.required_credential === undefined) {
      set('required_credential', DEFAULT_CREDENTIAL_BY_SETTING[input.setting]);
    }
  }
  if (input.required_credential !== undefined) set('required_credential', input.required_credential);
  if (input.starts_at !== undefined) set('starts_at', input.starts_at);
  if (input.duration_minutes !== undefined) {
    set('duration_minutes', input.duration_minutes);
    set('team_size', defaultTeamSize(input.duration_minutes));
  }
  if (input.city !== undefined) set('city', input.city);
  if (input.location_address !== undefined) set('location_address', input.location_address);
  if (input.consumer_name !== undefined) set('consumer_name', input.consumer_name);
  if (input.notes !== undefined) set('notes', input.notes);

  if (updates.length > 0) {
    await transact(async (client) => {
      await client.query(`UPDATE requests SET ${updates.join(', ')} WHERE id = $1`, values);
    });
  }
  return json(await viewById(actor, loaded.row.id, now));
}

async function submitRequest(ctx: RouteContext): Promise<RouteResult> {
  const actor = ctx.requireActor();
  const loaded = await readableRequest(actor, ctx.param('id'));
  ctx.gate('client_scheduler');
  requireStatus(loaded.row.status, ['draft']);
  requireJsonContentType(ctx.hasWrongContentType());
  const now = new Date();
  if (loaded.row.starts_at.getTime() <= now.getTime()) {
    throw validationError({ starts_at: 'Choose a start time in the future.' });
  }

  const teamSize = defaultTeamSize(loaded.row.duration_minutes);
  await transact(async (client) => {
    await client.query(`UPDATE requests SET status = 'submitted', team_size = $2 WHERE id = $1`, [
      loaded.row.id,
      teamSize,
    ]);
    for (const label of seatLabelsForTeamSize(teamSize)) {
      await client.query(
        `INSERT INTO seats (id, request_id, label, status) VALUES ($1, $2, $3, 'open')
           ON CONFLICT (request_id, label) DO NOTHING`,
        [newId('seat'), loaded.row.id, label],
      );
    }
    await writeHistory(
      client,
      loaded.row.id,
      actor.display_name,
      'submitted',
      `${teamSize} seats opened`,
    );
  });
  return json(await viewById(actor, loaded.row.id, now));
}

/**
 * Lowering to one keeps the confirmed seat, or seat A when both are open; raising to two
 * opens whichever label is missing.
 */
async function applyTeamSize(
  client: Queryable,
  requestId: string,
  seats: readonly SeatRow[],
  teamSize: number,
): Promise<void> {
  if (teamSize === 1) {
    if (seats.filter((seat) => seat.status === 'confirmed').length > 1) {
      throw new ApiError('invalid_transition');
    }
    const removable = seats
      .filter((seat) => seat.status === 'open')
      .sort((left, right) => right.label.localeCompare(left.label));
    const toRemove = removable[0];
    if (toRemove !== undefined && seats.length > 1) {
      await client.query(`DELETE FROM seats WHERE id = $1`, [toRemove.id]);
    }
    return;
  }
  const present = new Set(seats.map((seat) => seat.label));
  for (const label of SEAT_LABELS) {
    if (!present.has(label)) {
      await client.query(
        `INSERT INTO seats (id, request_id, label, status) VALUES ($1, $2, $3, 'open')
           ON CONFLICT (request_id, label) DO NOTHING`,
        [newId('seat'), requestId, label],
      );
    }
  }
}

async function patchStaffing(ctx: RouteContext): Promise<RouteResult> {
  const actor = ctx.requireActor();
  const loaded = await readableRequest(actor, ctx.param('id'));
  ctx.gate('coordinator');
  requireStatus(loaded.row.status, STAFFABLE);
  requireJsonContentType(ctx.hasWrongContentType());
  const defaultSize = defaultTeamSize(loaded.row.duration_minutes);
  const input = readStaffingFields(ctx.body(), defaultSize);
  const now = new Date();

  await transact(async (client) => {
    if (input.rotation_minutes !== undefined && input.rotation_minutes !== loaded.row.rotation_minutes) {
      await client.query(`UPDATE requests SET rotation_minutes = $2 WHERE id = $1`, [
        loaded.row.id,
        input.rotation_minutes,
      ]);
      await writeHistory(
        client,
        loaded.row.id,
        actor.display_name,
        'rotation_changed',
        `${input.rotation_minutes} minute rotation`,
      );
    }
    if (input.team_size !== undefined) {
      const reason = input.team_reason ?? null;
      if (input.team_size !== loaded.row.team_size) {
        await applyTeamSize(client, loaded.row.id, loaded.seats, input.team_size);
        const seats = await client.query<{ status: SeatStatus }>(
          `SELECT status FROM seats WHERE request_id = $1`,
          [loaded.row.id],
        );
        const status = derivedStatus(loaded.row.status, seats.rows);
        await client.query(
          `UPDATE requests SET team_size = $2, team_reason = $3, status = $4 WHERE id = $1`,
          [loaded.row.id, input.team_size, reason, status],
        );
        await writeHistory(
          client,
          loaded.row.id,
          actor.display_name,
          'team_changed',
          reason === null ? `team of ${input.team_size}` : `team of ${input.team_size}: ${reason}`,
        );
      } else if (reason !== null) {
        await client.query(`UPDATE requests SET team_reason = $2 WHERE id = $1`, [
          loaded.row.id,
          reason,
        ]);
      }
    }
  });
  return json(await viewById(actor, loaded.row.id, now));
}

interface EligibleInterpreter {
  id: string;
  email: string;
}

async function broadcastRequest(ctx: RouteContext): Promise<RouteResult> {
  const actor = ctx.requireActor();
  const loaded = await readableRequest(actor, ctx.param('id'));
  ctx.gate('coordinator');
  requireStatus(loaded.row.status, CLAIMABLE);
  requireJsonContentType(ctx.hasWrongContentType());

  const jobDate = agencyDateOf(loaded.row.starts_at);
  const window = {
    starts_at: loaded.row.starts_at,
    ends_at: endsAt(loaded.row.starts_at, loaded.row.duration_minutes),
  };
  const openSeatCount = loaded.seats.filter((seat) => seat.status === 'open').length;

  const emailed = await transact(async (client) => {
    const people = await client.query<{
      id: string;
      email: string;
      credential_type: CredentialType | null;
      verified: boolean | null;
      expires_on: string | null;
    }>(
      `SELECT p.id, p.email, c.credential_type, c.verified, to_char(c.expires_on, 'YYYY-MM-DD') AS expires_on
         FROM people p LEFT JOIN credentials c ON c.interpreter_id = p.id
        WHERE p.role = 'interpreter'`,
    );
    const byPerson = new Map<string, { email: string; credentials: CredentialRecord[] }>();
    for (const row of people.rows) {
      let entry = byPerson.get(row.id);
      if (entry === undefined) {
        entry = { email: row.email, credentials: [] };
        byPerson.set(row.id, entry);
      }
      if (row.credential_type !== null) {
        entry.credentials.push({
          credential_type: row.credential_type,
          verified: row.verified === true,
          expires_on: row.expires_on,
        });
      }
    }

    const busy = await client.query<{ interpreter_id: string; starts_at: Date; duration_minutes: number }>(
      `SELECT s.interpreter_id, r.starts_at, r.duration_minutes
         FROM seats s JOIN requests r ON r.id = s.request_id
        WHERE s.status = 'confirmed' AND s.interpreter_id IS NOT NULL
          AND r.status NOT IN ('cancelled_early', 'cancelled_late')`,
    );

    const eligible: EligibleInterpreter[] = [];
    for (const [id, entry] of byPerson) {
      if (!hasCredentialOnDate(entry.credentials, loaded.row.required_credential, jobDate)) continue;
      const clash = busy.rows.some(
        (seat) =>
          seat.interpreter_id === id &&
          windowsOverlap(window, {
            starts_at: seat.starts_at,
            ends_at: endsAt(seat.starts_at, seat.duration_minutes),
          }),
      );
      if (clash) continue;
      eligible.push({ id, email: entry.email });
    }

    await queueEmails(
      client,
      eligible.map((interpreter) =>
        openSeatEmail(
          {
            reference: loaded.row.reference,
            setting: loaded.row.setting,
            required_credential: loaded.row.required_credential,
            starts_at: window.starts_at,
            ends_at: window.ends_at,
            city: loaded.row.city,
          },
          openSeatCount,
          interpreter.email,
        ),
      ),
    );
    await writeHistory(
      client,
      loaded.row.id,
      actor.display_name,
      'broadcast',
      `${eligible.length} interpreters emailed`,
    );
    return eligible.length;
  });

  return json({ emailed });
}

async function completeRequest(ctx: RouteContext): Promise<RouteResult> {
  const actor = ctx.requireActor();
  const loaded = await readableRequest(actor, ctx.param('id'));
  ctx.gate('coordinator');
  requireStatus(loaded.row.status, COMPLETABLE);
  requireJsonContentType(ctx.hasWrongContentType());
  const actualMinutes = readActualMinutes(ctx.body());
  const now = new Date();

  await transact(async (client) => {
    await client.query(
      `UPDATE requests SET status = 'completed', actual_minutes = $2 WHERE id = $1`,
      [loaded.row.id, actualMinutes],
    );
    await writeHistory(
      client,
      loaded.row.id,
      actor.display_name,
      'completed',
      `${actualMinutes} actual minutes`,
    );
  });
  return json(await viewById(actor, loaded.row.id, now));
}

export const requestRoutes: Route[] = [
  route('GET', '/api/requests', listRequests),
  route('POST', '/api/requests', createRequest),
  route('GET', '/api/requests/:id', getRequest),
  route('PATCH', '/api/requests/:id', patchRequest),
  route('POST', '/api/requests/:id/submit', submitRequest),
  route('PATCH', '/api/requests/:id/staffing', patchStaffing),
  route('POST', '/api/requests/:id/broadcast', broadcastRequest),
  route('POST', '/api/requests/:id/complete', completeRequest),
];
