import { randomBytes } from 'node:crypto';
import { Queryable, db, nextId } from '../db';

export type EndpointState = 'active' | 'failing' | 'disabled';
export type EventState = 'pending' | 'delivered' | 'abandoned' | 'skipped_disabled';

export interface EndpointRecord {
  id: string;
  teamId: string;
  url: string;
  secret: string;
  state: EndpointState;
  consecutiveFailures: number;
  createdBy: string;
  createdAt: Date;
}

interface EndpointDbRow {
  id: string;
  team_id: string;
  url: string;
  secret: string;
  state: string;
  consecutive_failures: number;
  created_by: string;
  created_at: Date;
}

function toEndpoint(row: EndpointDbRow): EndpointRecord {
  return {
    id: row.id,
    teamId: row.team_id,
    url: row.url,
    secret: row.secret,
    state: row.state as EndpointState,
    consecutiveFailures: row.consecutive_failures,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

const COLUMNS = 'id, team_id, url, secret, state, consecutive_failures, created_by, created_at';

export function newSecret(): string {
  return `whsec_${randomBytes(16).toString('hex')}`;
}

export function newEventId(): string {
  return `evt_${randomBytes(12).toString('hex')}`;
}

export async function endpointCount(teamId: string): Promise<number> {
  const { rows } = await db.query<{ count: string }>(
    'SELECT count(*)::text AS count FROM webhook_endpoints WHERE team_id = $1 AND removed_at IS NULL',
    [teamId],
  );
  return Number.parseInt(rows[0]!.count, 10);
}

export async function insertEndpoint(teamId: string, url: string, createdBy: string): Promise<EndpointRecord> {
  const id = await nextId(db, 'endpoint_seq', 'we_');
  const { rows } = await db.query<EndpointDbRow>(
    `INSERT INTO webhook_endpoints (id, num, team_id, url, secret, state, consecutive_failures, created_by, created_at)
     VALUES ($1, $2, $3, $4, $5, 'active', 0, $6, now()) RETURNING ${COLUMNS}`,
    [id, id.slice(3), teamId, url, newSecret(), createdBy],
  );
  return toEndpoint(rows[0]!);
}

export async function endpointById(id: string): Promise<EndpointRecord | null> {
  const { rows } = await db.query<EndpointDbRow>(
    `SELECT ${COLUMNS} FROM webhook_endpoints WHERE id = $1 AND removed_at IS NULL`,
    [id],
  );
  return rows[0] ? toEndpoint(rows[0]) : null;
}

export async function endpointsOfTeam(teamId: string): Promise<EndpointRecord[]> {
  const { rows } = await db.query<EndpointDbRow>(
    `SELECT ${COLUMNS} FROM webhook_endpoints WHERE team_id = $1 AND removed_at IS NULL ORDER BY num`,
    [teamId],
  );
  return rows.map(toEndpoint);
}

export async function deliverableEndpointsOfTeam(client: Queryable, teamId: string): Promise<EndpointRecord[]> {
  const { rows } = await client.query<EndpointDbRow>(
    `SELECT ${COLUMNS} FROM webhook_endpoints
      WHERE team_id = $1 AND removed_at IS NULL AND state IN ('active', 'failing') ORDER BY num`,
    [teamId],
  );
  return rows.map(toEndpoint);
}

export async function removeEndpoint(id: string): Promise<void> {
  await db.query('UPDATE webhook_endpoints SET removed_at = now() WHERE id = $1', [id]);
}

export async function enableEndpoint(id: string): Promise<EndpointRecord | null> {
  const { rows } = await db.query<EndpointDbRow>(
    `UPDATE webhook_endpoints SET state = 'active', consecutive_failures = 0 WHERE id = $1 RETURNING ${COLUMNS}`,
    [id],
  );
  return rows[0] ? toEndpoint(rows[0]) : null;
}

export async function setEndpointFailure(id: string, failures: number, state: EndpointState): Promise<void> {
  await db.query('UPDATE webhook_endpoints SET consecutive_failures = $2, state = $3 WHERE id = $1', [
    id,
    failures,
    state,
  ]);
}

export interface EventRecord {
  id: string;
  endpointId: string;
  jobId: string;
  eventType: string;
  body: string;
  createdAt: Date;
  state: EventState;
  attempts: number;
  nextAttemptAt: Date;
  lastStatusCode: number | null;
}

interface EventDbRow {
  id: string;
  endpoint_id: string;
  job_id: string;
  event_type: string;
  body: string;
  created_at: Date;
  state: string;
  attempts: number;
  next_attempt_at: Date;
  last_status_code: number | null;
}

function toEvent(row: EventDbRow): EventRecord {
  return {
    id: row.id,
    endpointId: row.endpoint_id,
    jobId: row.job_id,
    eventType: row.event_type,
    body: row.body,
    createdAt: row.created_at,
    state: row.state as EventState,
    attempts: row.attempts,
    nextAttemptAt: row.next_attempt_at,
    lastStatusCode: row.last_status_code,
  };
}

const EVENT_COLUMNS =
  'id, endpoint_id, job_id, event_type, body, created_at, state, attempts, next_attempt_at, last_status_code';

export async function insertEvent(
  client: Queryable,
  input: { id: string; endpointId: string; jobId: string; eventType: string; body: string },
): Promise<void> {
  await client.query(
    `INSERT INTO webhook_events (id, endpoint_id, job_id, event_type, body, created_at, state, attempts, next_attempt_at)
     VALUES ($1, $2, $3, $4, $5, now(), 'pending', 0, now())`,
    [input.id, input.endpointId, input.jobId, input.eventType, input.body],
  );
}

/** The oldest event still waiting for an attempt on an endpoint; later events wait behind it. */
export async function nextPendingEvent(endpointId: string): Promise<EventRecord | null> {
  const { rows } = await db.query<EventDbRow>(
    `SELECT ${EVENT_COLUMNS} FROM webhook_events WHERE endpoint_id = $1 AND state = 'pending'
      ORDER BY created_at, id LIMIT 1`,
    [endpointId],
  );
  return rows[0] ? toEvent(rows[0]) : null;
}

export async function pendingEventsOf(endpointId: string): Promise<EventRecord[]> {
  const { rows } = await db.query<EventDbRow>(
    `SELECT ${EVENT_COLUMNS} FROM webhook_events WHERE endpoint_id = $1 AND state = 'pending' ORDER BY created_at, id`,
    [endpointId],
  );
  return rows.map(toEvent);
}

export async function setEventState(
  id: string,
  state: EventState,
  attempts: number,
  nextAttemptAt: Date,
  statusCode: number | null,
): Promise<void> {
  await db.query(
    `UPDATE webhook_events SET state = $2, attempts = $3, next_attempt_at = $4, last_status_code = $5 WHERE id = $1`,
    [id, state, attempts, nextAttemptAt, statusCode],
  );
}

export interface DeliveryRow {
  event_id: string;
  event_type: string;
  job_id: string;
  attempt: number;
  attempted_at: string;
  status_code: number | null;
  outcome: string;
  next_attempt_at: string | null;
}

export async function insertDelivery(input: {
  eventId: string;
  endpointId: string;
  eventType: string;
  jobId: string;
  attempt: number;
  statusCode: number | null;
  outcome: 'delivered' | 'failed' | 'skipped_disabled';
  nextAttemptAt: Date | null;
}): Promise<void> {
  await db.query(
    `INSERT INTO webhook_deliveries (event_id, endpoint_id, event_type, job_id, attempt, attempted_at, status_code,
       outcome, next_attempt_at) VALUES ($1, $2, $3, $4, $5, now(), $6, $7, $8)`,
    [
      input.eventId,
      input.endpointId,
      input.eventType,
      input.jobId,
      input.attempt,
      input.statusCode,
      input.outcome,
      input.nextAttemptAt,
    ],
  );
}

export async function deliveriesOf(endpointId: string): Promise<DeliveryRow[]> {
  const { rows } = await db.query<{
    event_id: string;
    event_type: string;
    job_id: string;
    attempt: number;
    attempted_at: Date;
    status_code: number | null;
    outcome: string;
    next_attempt_at: Date | null;
  }>(
    `SELECT event_id, event_type, job_id, attempt, attempted_at, status_code, outcome, next_attempt_at
       FROM webhook_deliveries WHERE endpoint_id = $1 ORDER BY id DESC`,
    [endpointId],
  );
  return rows.map((row) => ({
    event_id: row.event_id,
    event_type: row.event_type,
    job_id: row.job_id,
    attempt: row.attempt,
    attempted_at: row.attempted_at.toISOString(),
    status_code: row.status_code,
    outcome: row.outcome,
    next_attempt_at: row.next_attempt_at === null ? null : row.next_attempt_at.toISOString(),
  }));
}

export async function allDeliverableEndpoints(): Promise<EndpointRecord[]> {
  const { rows } = await db.query<EndpointDbRow>(
    `SELECT ${COLUMNS} FROM webhook_endpoints WHERE removed_at IS NULL AND state IN ('active', 'failing') ORDER BY num`,
  );
  return rows.map(toEndpoint);
}
