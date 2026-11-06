import { formatCents, formatMinutesAsHours, formatQuarterHours } from '../../shared/money';
import {
  PrepFile,
  Quote,
  RequestObject,
  RequestSeat,
  RequestStatus,
  SeatStatus,
  Setting,
  TimesheetStatus,
  OfferStatus,
} from '../../shared/types';
import {
  deriveRequestStatus,
  durationMinutesOf,
  isInCancellationWindow,
  seatsRequired,
} from './rules';
import { PoolClient } from 'pg';
import { Db, query, queryOne, withTransaction } from '../db/pool';
import { toIsoWithOffset } from '../../shared/time';
import { writeAudit } from './audit';

export interface RequestRow {
  id: string;
  ref: string;
  org_id: string;
  org_name: string;
  title: string;
  setting: Setting;
  location: string;
  start_at: Date;
  end_at: Date;
  consumer_id: string;
  consumer_name: string;
  notes: string;
  status: RequestStatus;
  logged_after: boolean;
  cancellation_fee_cents: number | null;
  cancellation_quote: Quote | null;
}

const REQUEST_SELECT = `
  select r.id, r.ref, r.org_id, o.name as org_name, r.title, r.setting, r.location,
         r.start_at, r.end_at, r.consumer_id, c.name as consumer_name, r.notes, r.status,
         r.logged_after, r.cancellation_fee_cents, r.cancellation_quote
  from requests r
  join orgs o on o.id = r.org_id
  join users c on c.id = r.consumer_id`;

interface SeatRow {
  id: string;
  request_id: string;
  position: number;
  status: SeatStatus;
  offer_id: string | null;
  offer_status: OfferStatus | null;
  sent_at: Date | null;
  expires_at: Date | null;
  interpreter_id: string | null;
  interpreter_name: string | null;
  held_by: string | null;
  holder_name: string | null;
  email_status: string | null;
  timesheet_id: string | null;
  timesheet_status: TimesheetStatus | null;
  billed_quarters: number | null;
  amount_cents: number | null;
}

const SEAT_SELECT = `
  select s.id, s.request_id, s.position, s.status,
         o.id as offer_id, o.status as offer_status, o.sent_at, o.expires_at,
         o.interpreter_id, i.name as interpreter_name, o.held_by, h.name as holder_name,
         ob.status as email_status,
         t.id as timesheet_id, t.status as timesheet_status, t.billed_quarters, t.amount_cents
  from seats s
  left join offers o on o.seat_id = s.id and o.status in ('active', 'accepted')
  left join users i on i.id = o.interpreter_id
  left join users h on h.id = o.held_by
  left join outbox ob on ob.id = o.outbox_id
  left join timesheets t on t.seat_id = s.id
  where s.request_id = any($1::uuid[])
  order by s.request_id, s.position`;

interface SeatView {
  row: SeatRow;
  status: SeatStatus;
  live: boolean;
}

/** An active offer past its expiry reads as open until the sweep rewrites it. */
function seatView(row: SeatRow, now: Date): SeatView {
  const expired =
    row.offer_status === 'active' && row.expires_at !== null && row.expires_at.getTime() <= now.getTime();
  if (row.offer_status === null || expired) {
    return { row, status: 'open', live: false };
  }
  return { row, status: row.offer_status === 'accepted' ? 'accepted' : 'offered', live: true };
}

function serializeSeat(view: SeatView): RequestSeat {
  const { row } = view;
  return {
    id: row.id,
    position: row.position,
    status: view.status,
    interpreter:
      view.live && row.interpreter_id && row.interpreter_name
        ? { id: row.interpreter_id, name: row.interpreter_name }
        : null,
    held_by:
      view.live && row.held_by && row.holder_name
        ? { id: row.held_by, name: row.holder_name }
        : null,
    offer:
      view.live && row.offer_id && row.offer_status && row.sent_at && row.expires_at
        ? {
            id: row.offer_id,
            status: row.offer_status,
            sent_at: toIsoWithOffset(row.sent_at),
            expires_at: toIsoWithOffset(row.expires_at),
            email: row.email_status === 'sent' ? 'sent' : 'queued',
          }
        : null,
    timesheet:
      row.timesheet_id && row.timesheet_status && row.billed_quarters !== null
        ? {
            id: row.timesheet_id,
            status: row.timesheet_status,
            billed_hours: formatQuarterHours(row.billed_quarters),
            amount: row.amount_cents === null ? null : formatCents(row.amount_cents),
          }
        : null,
  };
}

interface PrepRow {
  id: string;
  request_id: string;
  filename: string;
  size: number;
  content_type: string;
}

export async function loadRequestRow(db: Db, id: string): Promise<RequestRow | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  return queryOne<RequestRow>(db, `${REQUEST_SELECT} where r.id = $1`, [id]);
}


export async function listRequestRows(
  db: Db,
  filter: { orgId?: string; status?: RequestStatus; order: 'start_desc' | 'start_asc'; withinHours?: number; excludeCancelled?: boolean },
): Promise<RequestRow[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (filter.orgId) {
    params.push(filter.orgId);
    conditions.push(`r.org_id = $${params.length}`);
  }
  if (filter.status) {
    params.push(filter.status);
    conditions.push(`r.status = $${params.length}`);
  }
  if (filter.withinHours !== undefined) {
    params.push(filter.withinHours);
    conditions.push(`r.start_at >= now() and r.start_at <= now() + ($${params.length} || ' hours')::interval`);
  }
  if (filter.excludeCancelled) {
    conditions.push(`r.status not in ('cancelled_on_time', 'cancelled_late')`);
  }
  const where = conditions.length > 0 ? ` where ${conditions.join(' and ')}` : '';
  const order = filter.order === 'start_asc' ? 'order by r.start_at asc' : 'order by r.start_at desc';
  return query<RequestRow>(db, `${REQUEST_SELECT}${where} ${order}`, params);
}

export async function serializeRequests(
  db: Db,
  rows: readonly RequestRow[],
  now: Date,
): Promise<RequestObject[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((row) => row.id);
  const seatRows = await query<SeatRow>(db, SEAT_SELECT, [ids]);
  const prepRows = await query<PrepRow>(
    db,
    `select id, request_id, filename, size, content_type from prep_files
     where request_id = any($1::uuid[]) order by uploaded_at, filename`,
    [ids],
  );

  const result: RequestObject[] = [];
  for (const row of rows) {
    const seats = seatRows
      .filter((seat) => seat.request_id === row.id)
      .map((seat) => seatView(seat, now));
    const accepted = seats.filter((seat) => seat.status === 'accepted').length;
    const claimed = seats.filter((seat) => seat.status !== 'open').length;
    const approved = seats.filter((seat) => seat.row.timesheet_status === 'approved').length;
    const status = deriveRequestStatus({
      stored: row.status,
      seatsTotal: seats.length,
      seatsAccepted: accepted,
      approvedTimesheets: approved,
      endAt: row.end_at,
      now,
    });
    if (status !== row.status) {
      await refreshRequestStatus(row.id, null, now);
    }
    const durationMinutes = durationMinutesOf(row.start_at, row.end_at);
    const prepFiles: PrepFile[] = prepRows
      .filter((file) => file.request_id === row.id)
      .map((file) => ({
        id: file.id,
        filename: file.filename,
        size: file.size,
        content_type: file.content_type,
      }));
    result.push({
      id: row.id,
      ref: row.ref,
      org_id: row.org_id,
      org_name: row.org_name,
      title: row.title,
      setting: row.setting,
      location: row.location,
      start: toIsoWithOffset(row.start_at),
      end: toIsoWithOffset(row.end_at),
      duration_hours: formatMinutesAsHours(durationMinutes),
      consumer: { id: row.consumer_id, name: row.consumer_name },
      notes: row.notes,
      status,
      logged_after: row.logged_after,
      seats_total: seats.length,
      seats_claimed: claimed,
      seats_accepted: accepted,
      in_cancellation_window: isInCancellationWindow({
        status,
        durationMinutes,
        startAt: row.start_at,
        now,
      }),
      cancellation_fee:
        row.cancellation_fee_cents === null ? null : formatCents(row.cancellation_fee_cents),
      seats: seats.map(serializeSeat),
      prep_files: prepFiles,
    });
  }
  return result;
}

export async function serializeRequest(
  db: Db,
  row: RequestRow,
  now: Date,
): Promise<RequestObject> {
  const [serialized] = await serializeRequests(db, [row], now);
  if (!serialized) throw new Error(`cannot serialize request ${row.id}`);
  return serialized;
}

/**
 * Persists the status derived from seats, times and timesheets, writing the
 * `request.status_changed` entry for changes no request action caused.
 */
export async function refreshRequestStatusIn(
  client: PoolClient,
  requestId: string,
  actorId: string | null,
  now: Date,
): Promise<RequestStatus> {
  const row = await queryOne<{ status: RequestStatus; end_at: Date }>(
    client,
    'select status, end_at from requests where id = $1 for update',
    [requestId],
  );
  if (!row) throw new Error(`no request ${requestId}`);
  const counts = await queryOne<{
    seats_total: number;
    seats_accepted: number;
    approved: number;
  }>(
    client,
    `select count(*)::int as seats_total,
            count(*) filter (where s.status = 'accepted')::int as seats_accepted,
            count(*) filter (where t.status = 'approved')::int as approved
     from seats s
     left join timesheets t on t.seat_id = s.id
     where s.request_id = $1`,
    [requestId],
  );
  const derived = deriveRequestStatus({
    stored: row.status,
    seatsTotal: counts?.seats_total ?? 0,
    seatsAccepted: counts?.seats_accepted ?? 0,
    approvedTimesheets: counts?.approved ?? 0,
    endAt: row.end_at,
    now,
  });
  if (derived === row.status) return row.status;
  await client.query('update requests set status = $2 where id = $1', [requestId, derived]);
  await writeAudit(client, {
    actorId: derived === 'completed' ? null : actorId,
    action: 'request.status_changed',
    entity: 'request',
    entityId: requestId,
    requestId,
    from: row.status,
    to: derived,
  });
  return derived;
}

export async function refreshRequestStatus(
  requestId: string,
  actorId: string | null,
  now: Date,
): Promise<RequestStatus> {
  return withTransaction((client) => refreshRequestStatusIn(client, requestId, actorId, now));
}

/** Seats follow the team rule and are rebuilt whenever a draft's setting or length changes. */
export async function applySeatPlan(
  db: Db,
  requestId: string,
  setting: Setting,
  durationMinutes: number,
): Promise<void> {
  const total = seatsRequired(setting, durationMinutes);
  const existing = await query<{ id: string; position: number }>(
    db,
    'select id, position from seats where request_id = $1 order by position',
    [requestId],
  );
  for (let position = existing.length + 1; position <= total; position += 1) {
    await db.query('insert into seats (request_id, position, status) values ($1, $2, $3)', [
      requestId,
      position,
      'open',
    ]);
  }
  if (existing.length > total) {
    await db.query('delete from seats where request_id = $1 and position > $2', [requestId, total]);
  }
}

export async function nextRequestRef(db: Db): Promise<string> {
  const row = await queryOne<{ ref: string }>(
    db,
    `select 'FA-' || nextval('request_ref_seq')::text as ref`,
  );
  if (!row) throw new Error('cannot allocate a request ref');
  return row.ref;
}
