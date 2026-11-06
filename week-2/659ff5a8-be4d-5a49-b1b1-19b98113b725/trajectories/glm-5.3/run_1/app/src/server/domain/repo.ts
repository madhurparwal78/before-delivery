// Shared data access helpers used across the API.
import type { Db, Row } from "../db.js";
import type { EventRow, RegistrationRow, RunDbRow, StationRow, EventStatus } from "./types.js";
import { reportedStatus } from "./states.js";
import { fmtFactor, fmtTime } from "./times.js";
import type { RunObj } from "./types.js";

export function mapEvent(r: Row): EventRow {
  return {
    id: r.id as string,
    club_id: r.club_id as string,
    name: r.name as string,
    date: typeof r.date === "string" ? r.date : String(r.date),
    venue: r.venue as string,
    registration_cutoff: new Date(r.registration_cutoff as string),
    runs_per_driver: r.runs_per_driver as number,
    heat_classes: r.heat_classes as Record<string, string[]>,
    stations: r.stations as string[],
    status: r.status as EventStatus,
    running_heat: (r.running_heat as number | null) ?? null,
    provisional_at: r.provisional_at ? new Date(r.provisional_at as string) : null,
    protest_window_closes_at: r.protest_window_closes_at ? new Date(r.protest_window_closes_at as string) : null,
    version: r.version as number,
    index_table_id: r.index_table_id as string,
    published_at: r.published_at ? new Date(r.published_at as string) : null,
    results_checksum: (r.results_checksum as string | null) ?? null,
    effective_date: typeof r.effective_date === "string" ? r.effective_date : String(r.effective_date),
    factors: r.factors as Record<string, string>,
    time_zone: r.time_zone as string,
  };
}

const EVENT_SQL = `
  SELECT e.*, t.effective_date, t.factors, c.time_zone
  FROM events e
  JOIN index_tables t ON t.id = e.index_table_id
  JOIN clubs c ON c.id = e.club_id
`;

export async function getEvent(db: Db, eventId: string, clubId: string | null): Promise<EventRow | null> {
  const rows = await db.query(`${EVENT_SQL} WHERE e.id = $1`, [eventId]);
  const event = rows[0] ? mapEvent(rows[0]) : null;
  if (!event) return null;
  if (clubId !== null && event.club_id !== clubId) return null;
  return event;
}

export const EVENT_LIST_SQL = `
  SELECT e.*, t.effective_date, t.factors, c.time_zone
  FROM events e
  JOIN index_tables t ON t.id = e.index_table_id
  JOIN clubs c ON c.id = e.club_id
  WHERE e.club_id = $1
  ORDER BY e.date, e.created_at
`;

export async function getRegistration(db: Db, registrationId: string, clubId: string | null): Promise<RegistrationRow | null> {
  const rows = await db.query(
    `SELECT r.*, u.name AS driver_name, u.email AS driver_email,
            s.id AS station_id, s.name AS station_name, s.heat AS station_heat
     FROM registrations r
     JOIN users u ON u.id = r.driver_id
     JOIN events e ON e.id = r.event_id
     LEFT JOIN stations s ON s.registration_id = r.id
     WHERE r.id = $1`,
    [registrationId],
  );
  if (!rows[0]) return null;
  const reg = mapRegistration(rows[0]);
  if (clubId !== null) {
    const clubRows = await db.query(`SELECT club_id FROM events WHERE id = $1`, [reg.event_id]);
    if (!clubRows[0] || clubRows[0].club_id !== clubId) return null;
  }
  return reg;
}

export function mapRegistration(r: Row): RegistrationRow {
  return {
    id: r.id as string,
    event_id: r.event_id as string,
    driver_id: r.driver_id as string,
    driver_name: r.driver_name as string,
    driver_email: r.driver_email as string,
    class_code: r.class_code as string,
    car_number: r.car_number as number,
    car_description: r.car_description as string,
    run_heat: r.run_heat as number,
    checked_in_at: r.checked_in_at ? new Date(r.checked_in_at as string) : null,
    waiver_key: (r.waiver_key as string | null) ?? null,
    waiver_checksum: (r.waiver_checksum as string | null) ?? null,
    confirmation_email: r.confirmation_email as string,
    station_id: (r.station_id as string | null) ?? null,
    station_name: (r.station_name as string | null) ?? null,
    station_heat: (r.station_heat as number | null) ?? null,
  };
}

export async function eventRegistrations(db: Db, eventId: string): Promise<RegistrationRow[]> {
  const rows = await db.query(
    `SELECT r.*, u.name AS driver_name, u.email AS driver_email,
            s.id AS station_id, s.name AS station_name, s.heat AS station_heat
     FROM registrations r
     JOIN users u ON u.id = r.driver_id
     LEFT JOIN stations s ON s.registration_id = r.id
     WHERE r.event_id = $1
     ORDER BY r.class_code, r.car_number`,
    [eventId],
  );
  return rows.map(mapRegistration);
}

export async function eventStations(db: Db, eventId: string): Promise<StationRow[]> {
  const rows = await db.query(
    `SELECT s.id, s.event_id, s.name, s.heat, s.registration_id,
            r.car_number, r.class_code, u.name AS worker_name
     FROM stations s
     LEFT JOIN registrations r ON r.id = s.registration_id
     LEFT JOIN users u ON u.id = r.driver_id
     WHERE s.event_id = $1
     ORDER BY s.heat, s.name`,
    [eventId],
  );
  return rows.map((r) => ({
    id: r.id as string,
    event_id: r.event_id as string,
    name: r.name as string,
    heat: r.heat as number,
    registration_id: (r.registration_id as string | null) ?? null,
    worker_name: (r.worker_name as string | null) ?? null,
    car_number: (r.car_number as number | null) ?? null,
    class_code: (r.class_code as string | null) ?? null,
  }));
}

export function mapRun(r: Row): RunDbRow {
  return {
    id: r.id as string,
    registration_id: r.registration_id as string,
    run_number: r.run_number as number,
    status: r.status as string,
    outcome: (r.outcome as string | null) ?? null,
    raw_time: (r.raw_time as string | null) ?? null,
    cones: (r.cones as number | null) ?? null,
    adjusted_time: (r.adjusted_time as string | null) ?? null,
    indexed_time: (r.indexed_time as string | null) ?? null,
    factor: (r.factor as string | null) ?? null,
    committed_at: r.committed_at ? new Date(r.committed_at as string) : null,
    committed_by_name: (r.committed_by_name as string | null) ?? null,
  };
}

export async function registrationRuns(db: Db, registrationId: string): Promise<RunDbRow[]> {
  const rows = await db.query(
    `SELECT ru.*, u.name AS committed_by_name
     FROM runs ru
     LEFT JOIN users u ON u.id = ru.committed_by
     WHERE ru.registration_id = $1
     ORDER BY ru.run_number`,
    [registrationId],
  );
  return rows.map(mapRun);
}

export function runObj(run: RunDbRow, committedById: string | null): RunObj {
  return {
    id: run.id,
    runNumber: run.run_number,
    status: run.status as RunObj["status"],
    outcome: run.outcome as RunObj["outcome"],
    rawTime: fmtTime(run.raw_time),
    cones: run.cones,
    adjustedTime: fmtTime(run.adjusted_time),
    indexedTime: fmtTime(run.indexed_time),
    factor: run.factor ? fmtFactor(run.factor) : null,
    committedAt: run.committed_at ? new Date(run.committed_at).toISOString() : null,
    committedBy: run.committed_by_name
      ? { id: committedById ?? "", name: run.committed_by_name }
      : null,
  };
}

/** The event object as published by the API, with server-decided flags. */
export function eventObject(event: EventRow, now: Date): Record<string, unknown> {
  const status = reportedStatus(event.status, event.registration_cutoff, now);
  const heats = Object.keys(event.heat_classes)
    .map(Number)
    .sort((a, b) => a - b)
    .map((number) => ({ number, classes: event.heat_classes[number] ?? [] }));
  return {
    id: event.id,
    name: event.name,
    date: event.date,
    venue: event.venue,
    timeZone: event.time_zone,
    registrationCutoff: localCutoffText(event),
    registrationCutoffUtc: event.registration_cutoff.toISOString(),
    runsPerDriver: event.runs_per_driver,
    heats,
    stations: event.stations,
    status,
    registrationOpen: status === "registration_open",
    runningHeat: event.running_heat,
    provisionalAt: event.provisional_at ? event.provisional_at.toISOString() : null,
    protestWindowClosesAt: event.protest_window_closes_at ? event.protest_window_closes_at.toISOString() : null,
    protestWindowOpen: protestWindowOpenNow(event, now),
    indexTable: { id: event.index_table_id, effectiveDate: event.effective_date },
    factors: Object.fromEntries(
      Object.entries(event.factors).map(([k, v]) => [k, fmtFactor(v)]),
    ),
    version: event.version,
    publishedAt: event.published_at ? event.published_at.toISOString() : null,
    resultsChecksum: event.results_checksum,
    serverTime: now.toISOString(),
  };
}

function localCutoffText(event: EventRow): string {
  // registrationCutoff is stored as UTC; the API also publishes it as club-local text.
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: event.time_zone, hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  }).formatToParts(event.registration_cutoff);
  const map: Record<string, string> = {};
  for (const p of parts) map[p.type] = p.value;
  return `${map.year}-${map.month}-${map.day}T${map.hour === "24" ? "00" : map.hour}:${map.minute}`;
}

function protestWindowOpenNow(event: EventRow, now: Date): boolean {
  if (!event.protest_window_closes_at) return false;
  return now.getTime() < event.protest_window_closes_at.getTime();
}
