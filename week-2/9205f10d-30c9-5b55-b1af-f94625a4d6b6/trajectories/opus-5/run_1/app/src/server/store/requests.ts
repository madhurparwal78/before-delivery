import type { Queryable, QueryValue } from '../db.js';
import { query } from '../db.js';
import type {
  CredentialType,
  RequestStatus,
  SeatLabel,
  SeatStatus,
  Setting,
} from '../../shared/types.js';
import type { CredentialRecord } from '../domain/eligibility.js';

export interface SeatRow {
  id: string;
  request_id: string;
  label: SeatLabel;
  status: SeatStatus;
  interpreter_id: string | null;
}

export interface InterpreterRow {
  id: string;
  display_name: string;
  full_name: string;
  email: string;
  phone: string;
  home_area: string;
  pay_rate: string;
  credentials: CredentialRecord[];
}

export interface RequestRow {
  id: string;
  reference: string;
  organisation_id: string;
  organisation_name: string;
  organisation_code: string;
  hourly_rate: string;
  setting: Setting;
  required_credential: CredentialType;
  starts_at: Date;
  duration_minutes: number;
  city: string;
  location_address: string;
  consumer_name: string;
  notes: string;
  status: RequestStatus;
  team_size: number;
  rotation_minutes: number;
  team_reason: string | null;
  actual_minutes: number | null;
}

export interface LoadedRequest {
  row: RequestRow;
  seats: SeatRow[];
  interpreters: Map<string, InterpreterRow>;
}

const REQUEST_COLUMNS = `
  r.id, r.reference, r.organisation_id, o.name AS organisation_name, o.code AS organisation_code,
  o.hourly_rate, r.setting, r.required_credential, r.starts_at, r.duration_minutes, r.city,
  r.location_address, r.consumer_name, r.notes, r.status, r.team_size, r.rotation_minutes,
  r.team_reason, r.actual_minutes`;

const defaultClient: Queryable = { query };

export async function loadRequestRows(
  where: string,
  values: QueryValue[],
  client: Queryable = defaultClient,
): Promise<RequestRow[]> {
  const result = await client.query<RequestRow>(
    `SELECT ${REQUEST_COLUMNS} FROM requests r
       JOIN organisations o ON o.id = r.organisation_id
      WHERE ${where}
      ORDER BY r.starts_at, r.reference`,
    values,
  );
  return result.rows;
}

export async function loadSeatsFor(
  requestIds: readonly string[],
  client: Queryable = defaultClient,
): Promise<SeatRow[]> {
  if (requestIds.length === 0) return [];
  const result = await client.query<SeatRow>(
    `SELECT id, request_id, label, status, interpreter_id FROM seats
      WHERE request_id = ANY($1::text[]) ORDER BY label`,
    [[...requestIds]],
  );
  return result.rows;
}

interface InterpreterQueryRow {
  id: string;
  display_name: string;
  full_name: string;
  email: string;
  phone: string | null;
  home_area: string | null;
  pay_rate: string | null;
  credential_type: CredentialType | null;
  verified: boolean | null;
  expires_on: string | null;
}

export async function loadInterpreters(
  ids: readonly string[],
  client: Queryable = defaultClient,
): Promise<Map<string, InterpreterRow>> {
  const interpreters = new Map<string, InterpreterRow>();
  if (ids.length === 0) return interpreters;
  const result = await client.query<InterpreterQueryRow>(
    `SELECT p.id, p.display_name, p.full_name, p.email, p.phone, p.home_area, p.pay_rate,
            c.credential_type, c.verified, to_char(c.expires_on, 'YYYY-MM-DD') AS expires_on
       FROM people p
       LEFT JOIN credentials c ON c.interpreter_id = p.id
      WHERE p.id = ANY($1::text[])`,
    [[...ids]],
  );
  for (const row of result.rows) {
    let interpreter = interpreters.get(row.id);
    if (!interpreter) {
      interpreter = {
        id: row.id,
        display_name: row.display_name,
        full_name: row.full_name,
        email: row.email,
        phone: row.phone ?? '',
        home_area: row.home_area ?? '',
        pay_rate: row.pay_rate ?? '0.00',
        credentials: [],
      };
      interpreters.set(row.id, interpreter);
    }
    if (row.credential_type !== null) {
      interpreter.credentials.push({
        credential_type: row.credential_type,
        verified: row.verified === true,
        expires_on: row.expires_on,
      });
    }
  }
  return interpreters;
}

export async function hydrate(
  rows: readonly RequestRow[],
  client: Queryable = defaultClient,
): Promise<LoadedRequest[]> {
  const seats = await loadSeatsFor(
    rows.map((row) => row.id),
    client,
  );
  const interpreterIds = [
    ...new Set(seats.map((seat) => seat.interpreter_id).filter((id): id is string => id !== null)),
  ];
  const interpreters = await loadInterpreters(interpreterIds, client);
  return rows.map((row) => ({
    row,
    seats: seats.filter((seat) => seat.request_id === row.id),
    interpreters,
  }));
}

export async function loadOneById(
  id: string,
  client: Queryable = defaultClient,
): Promise<LoadedRequest | null> {
  const rows = await loadRequestRows('r.id = $1', [id], client);
  const first = rows[0];
  if (!first) return null;
  const hydrated = await hydrate([first], client);
  return hydrated[0] ?? null;
}

export interface HistoryRow {
  at: Date;
  actor: string;
  action: string;
  detail: string;
}

export async function loadHistory(
  requestId: string,
  client: Queryable = defaultClient,
): Promise<HistoryRow[]> {
  const result = await client.query<HistoryRow>(
    `SELECT at, actor, action, detail FROM request_history WHERE request_id = $1 ORDER BY id`,
    [requestId],
  );
  return result.rows;
}

export async function writeHistory(
  client: Queryable,
  requestId: string,
  actor: string,
  action: string,
  detail: string,
): Promise<void> {
  await client.query(
    `INSERT INTO request_history (request_id, actor, action, detail) VALUES ($1, $2, $3, $4)`,
    [requestId, actor, action, detail],
  );
}

export async function nextReference(client: Queryable): Promise<string> {
  const result = await client.query<{ value: number }>(
    `INSERT INTO counters (name, value) VALUES ('reference', 1001)
       ON CONFLICT (name) DO UPDATE SET value = counters.value + 1
       RETURNING value`,
    [],
  );
  const value = result.rows[0]?.value ?? 1001;
  return `CR-${value}`;
}
