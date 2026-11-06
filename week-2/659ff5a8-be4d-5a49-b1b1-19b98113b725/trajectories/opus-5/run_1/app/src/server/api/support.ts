import type { PoolClient } from 'pg';
import type {
  ClubRole,
  EventDto,
  EventStatus,
  HeatSpec,
  RegistrationDto,
  RunDto,
  StandingsView,
} from '../../shared/api';
import { hasClubRole, isOperator, type Actor, type ClubRow } from '../auth';
import { query, queryOne } from '../db/pool';
import { formatFactor, formatTime } from '../domain/decimal';
import { isProtestWindowOpen, isRegistrationOpen, reportedStatus } from '../domain/eventState';
import { isoUtc } from '../domain/clubTime';
import { apiError } from '../http/errors';
import type { RequestContext } from '../http/router';

export interface EventRecord {
  id: string;
  club_id: string;
  name: string;
  event_date: string;
  venue: string;
  registration_cutoff_local: string;
  registration_cutoff_utc: Date;
  runs_per_driver: number;
  heats: HeatSpec[];
  stations: string[];
  status: EventStatus;
  running_heat: number | null;
  provisional_at: Date | null;
  protest_window_closes_at: Date | null;
  version: number;
  published_at: Date | null;
  results_checksum: string | null;
}

export interface IndexTableRecord {
  id: string;
  club_id: string;
  effective_date: string;
  factors: Record<string, string>;
  created_at: Date;
  created_by: string | null;
}

export interface RegistrationRecord {
  id: string;
  event_id: string;
  driver_id: string;
  driver_name: string;
  driver_email: string;
  class_code: string;
  car_number: number;
  car_description: string;
  run_heat: number;
  checked_in: boolean;
  checked_in_at: Date | null;
  waiver_key: string | null;
  waiver_checksum: string | null;
  last_change_run_number: number | null;
  last_change_at: Date | null;
  last_change_indexed: string | null;
  last_change_class: string | null;
  last_change_raw: string | null;
}

export interface RunRecord {
  id: string;
  registration_id: string;
  run_number: number;
  status: 'pending' | 'committed' | 'corrected' | 'rerun_granted';
  outcome: 'time' | 'dnf' | 'rerun' | null;
  raw_time_ms: number | null;
  cones: number | null;
  adjusted_ms: number | null;
  indexed_ms: number | null;
  factor_tt: number | null;
  committed_at: Date | null;
  committed_by: string | null;
  committed_by_name: string | null;
}

const EVENT_COLUMNS = `id, club_id, name, event_date, venue, registration_cutoff_local,
  registration_cutoff_utc, runs_per_driver, heats, stations, status, running_heat,
  provisional_at, protest_window_closes_at, version, published_at, results_checksum`;

const REGISTRATION_COLUMNS = `r.id, r.event_id, r.driver_id, u.name AS driver_name, u.email AS driver_email,
  r.class_code, r.car_number, r.car_description, r.run_heat, r.checked_in, r.checked_in_at,
  r.waiver_key, r.waiver_checksum, r.last_change_run_number, r.last_change_at,
  r.last_change_indexed, r.last_change_class, r.last_change_raw`;

const RUN_COLUMNS = `n.id, n.registration_id, n.run_number, n.status, n.outcome, n.raw_time_ms,
  n.cones, n.adjusted_ms, n.indexed_ms, n.factor_tt, n.committed_at, n.committed_by,
  a.name AS committed_by_name`;

/** Club endpoints are closed to the operator, who holds no club. */
export function clubOf(actor: Actor): ClubRow {
  if (actor.club === null) throw apiError.forbidden();
  return actor.club;
}

export function requireRole(actor: Actor, ...roles: ClubRole[]): void {
  if (isOperator(actor) || !hasClubRole(actor, ...roles)) throw apiError.forbidden();
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function uuidParam(ctx: RequestContext, name: string): string {
  const value = ctx.params[name] ?? '';
  if (!UUID_PATTERN.test(value)) throw apiError.notFound();
  return value;
}

export async function loadEvent(ctx: RequestContext, client?: PoolClient): Promise<EventRecord> {
  const id = uuidParam(ctx, 'id');
  const sql = `SELECT ${EVENT_COLUMNS} FROM events WHERE id = $1 AND club_id = $2`;
  const params = [id, clubOf(ctx.actor).id];
  const row = client
    ? ((await client.query<EventRecord>(sql, params)).rows[0] ?? null)
    : await queryOne<EventRecord>(sql, params);
  if (!row) throw apiError.notFound();
  return row;
}

export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

export async function loadEventById(
  clubId: string,
  eventId: string,
  client?: PoolClient,
): Promise<EventRecord | null> {
  if (!isUuid(eventId)) return null;
  const sql = `SELECT ${EVENT_COLUMNS} FROM events WHERE id = $1 AND club_id = $2`;
  const params = [eventId, clubId];
  if (client) return (await client.query<EventRecord>(sql, params)).rows[0] ?? null;
  return queryOne<EventRecord>(sql, params);
}

export async function listClubEvents(clubId: string): Promise<EventRecord[]> {
  return query<EventRecord>(
    `SELECT ${EVENT_COLUMNS} FROM events WHERE club_id = $1 ORDER BY event_date, name`,
    [clubId],
  );
}

export async function tableInForce(
  clubId: string,
  onDate: string,
  client?: PoolClient,
): Promise<IndexTableRecord | null> {
  const sql = `SELECT id, club_id, effective_date, factors, created_at, created_by
                 FROM index_tables
                WHERE club_id = $1 AND effective_date <= $2
                ORDER BY effective_date DESC LIMIT 1`;
  const params = [clubId, onDate];
  if (client) return (await client.query<IndexTableRecord>(sql, params)).rows[0] ?? null;
  return queryOne<IndexTableRecord>(sql, params);
}

export async function requireTableInForce(
  clubId: string,
  onDate: string,
  client?: PoolClient,
): Promise<IndexTableRecord> {
  const table = await tableInForce(clubId, onDate, client);
  if (!table) throw apiError.notFound();
  return table;
}

export function eventClasses(event: EventRecord): string[] {
  return event.heats.flatMap((heat) => heat.classes);
}

export function heatForClass(event: EventRecord, classCode: string): number | null {
  for (const heat of event.heats) {
    if (heat.classes.includes(classCode)) return heat.number;
  }
  return null;
}

export function eventFactors(
  event: EventRecord,
  table: IndexTableRecord,
): Record<string, string> {
  const factors: Record<string, string> = {};
  for (const classCode of eventClasses(event)) {
    const factor = table.factors[classCode];
    if (factor !== undefined) factors[classCode] = factor;
  }
  return factors;
}

export function eventDto(
  event: EventRecord,
  club: ClubRow,
  table: IndexTableRecord,
  now: Date,
): EventDto {
  return {
    id: event.id,
    name: event.name,
    date: event.event_date,
    venue: event.venue,
    timeZone: club.time_zone,
    registrationCutoff: event.registration_cutoff_local,
    registrationCutoffUtc: isoUtc(event.registration_cutoff_utc),
    runsPerDriver: event.runs_per_driver,
    heats: event.heats,
    stations: event.stations,
    status: reportedStatus(event.status, event.registration_cutoff_utc, now),
    registrationOpen: isRegistrationOpen(event.status, event.registration_cutoff_utc, now),
    runningHeat: event.running_heat,
    provisionalAt: event.provisional_at ? isoUtc(event.provisional_at) : null,
    protestWindowClosesAt: event.protest_window_closes_at
      ? isoUtc(event.protest_window_closes_at)
      : null,
    protestWindowOpen: isProtestWindowOpen(event.protest_window_closes_at, now),
    indexTable: { id: table.id, effectiveDate: table.effective_date },
    factors: eventFactors(event, table),
    version: event.version,
    publishedAt: event.published_at ? isoUtc(event.published_at) : null,
    resultsChecksum: event.results_checksum,
    serverTime: isoUtc(now),
  };
}

export function statusOf(event: EventRecord, now: Date): EventStatus {
  return reportedStatus(event.status, event.registration_cutoff_utc, now);
}

export async function listRegistrations(
  eventId: string,
  client?: PoolClient,
): Promise<RegistrationRecord[]> {
  const sql = `SELECT ${REGISTRATION_COLUMNS}
                 FROM registrations r JOIN users u ON u.id = r.driver_id
                WHERE r.event_id = $1
                ORDER BY r.class_code, r.car_number`;
  if (client) return (await client.query<RegistrationRecord>(sql, [eventId])).rows;
  return query<RegistrationRecord>(sql, [eventId]);
}

export async function loadRegistration(
  clubId: string,
  registrationId: string,
  client?: PoolClient,
): Promise<RegistrationRecord | null> {
  if (!isUuid(registrationId)) return null;
  const sql = `SELECT ${REGISTRATION_COLUMNS}
                 FROM registrations r
                 JOIN users u ON u.id = r.driver_id
                 JOIN events e ON e.id = r.event_id
                WHERE r.id = $1 AND e.club_id = $2`;
  const params = [registrationId, clubId];
  if (client) return (await client.query<RegistrationRecord>(sql, params)).rows[0] ?? null;
  return queryOne<RegistrationRecord>(sql, params);
}

export async function listRuns(eventId: string, client?: PoolClient): Promise<RunRecord[]> {
  const sql = `SELECT ${RUN_COLUMNS}
                 FROM runs n
                 JOIN registrations r ON r.id = n.registration_id
                 LEFT JOIN users a ON a.id = n.committed_by
                WHERE r.event_id = $1
                ORDER BY n.run_number`;
  if (client) return (await client.query<RunRecord>(sql, [eventId])).rows;
  return query<RunRecord>(sql, [eventId]);
}

export async function runsForRegistration(
  registrationId: string,
  client?: PoolClient,
): Promise<RunRecord[]> {
  const sql = `SELECT ${RUN_COLUMNS}
                 FROM runs n
                 LEFT JOIN users a ON a.id = n.committed_by
                WHERE n.registration_id = $1
                ORDER BY n.run_number`;
  if (client) return (await client.query<RunRecord>(sql, [registrationId])).rows;
  return query<RunRecord>(sql, [registrationId]);
}

export function runDto(run: RunRecord): RunDto {
  return {
    id: run.id,
    runNumber: run.run_number,
    status: run.status,
    outcome: run.outcome,
    rawTime: formatTime(run.raw_time_ms),
    cones: run.cones,
    adjustedTime: formatTime(run.adjusted_ms),
    indexedTime: formatTime(run.indexed_ms),
    factor: formatFactor(run.factor_tt),
    committedAt: run.committed_at ? isoUtc(run.committed_at) : null,
    committedBy:
      run.committed_by && run.committed_by_name
        ? { id: run.committed_by, name: run.committed_by_name }
        : null,
  };
}

export interface StationRecord {
  id: string;
  event_id: string;
  heat: number;
  name: string;
  ordinal: number;
  worker_registration_id: string | null;
}

export async function listStations(
  eventId: string,
  client?: PoolClient,
): Promise<StationRecord[]> {
  const sql = `SELECT id, event_id, heat, name, ordinal, worker_registration_id
                 FROM stations WHERE event_id = $1 ORDER BY heat, ordinal`;
  if (client) return (await client.query<StationRecord>(sql, [eventId])).rows;
  return query<StationRecord>(sql, [eventId]);
}

export async function registrationDto(
  registration: RegistrationRecord,
  client?: PoolClient,
): Promise<RegistrationDto> {
  const stations = await (client
    ? client.query<StationRecord>(
        `SELECT id, event_id, heat, name, ordinal, worker_registration_id FROM stations
          WHERE worker_registration_id = $1`,
        [registration.id],
      ).then((result) => result.rows)
    : query<StationRecord>(
        `SELECT id, event_id, heat, name, ordinal, worker_registration_id FROM stations
          WHERE worker_registration_id = $1`,
        [registration.id],
      ));
  const station = stations[0];
  const confirmationRows = await (client
    ? client
        .query<{ state: string }>(
          `SELECT state FROM email_deliveries
            WHERE registration_id = $1 AND kind = 'registration_confirmation'`,
          [registration.id],
        )
        .then((result) => result.rows)
    : query<{ state: string }>(
        `SELECT state FROM email_deliveries
          WHERE registration_id = $1 AND kind = 'registration_confirmation'`,
        [registration.id],
      ));
  return {
    id: registration.id,
    eventId: registration.event_id,
    driver: { id: registration.driver_id, name: registration.driver_name },
    classCode: registration.class_code,
    carNumber: registration.car_number,
    carDescription: registration.car_description,
    runHeat: registration.run_heat,
    checkedIn: registration.checked_in,
    checkedInAt: registration.checked_in_at ? isoUtc(registration.checked_in_at) : null,
    waiver:
      registration.waiver_key && registration.waiver_checksum
        ? { key: registration.waiver_key, checksum: registration.waiver_checksum }
        : null,
    station: station ? { id: station.id, name: station.name, heat: station.heat } : null,
    confirmationEmail: confirmationRows[0]?.state === 'sent' ? 'sent' : 'pending',
  };
}

export function parseView(value: string | null): StandingsView {
  if (value === null || value === 'indexed') return 'indexed';
  if (value === 'class' || value === 'raw') return value;
  throw apiError.validation({ view: 'View must be indexed, class or raw.' });
}
