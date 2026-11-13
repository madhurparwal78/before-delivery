import type { Queryable } from './db.js';
import { pool } from './db.js';
import { deriveFromKit } from '../shared/optics.js';
import {
  eveningDate,
  formatTimestamp,
  localClock,
  utcOffset,
} from '../shared/clock.js';
import type { CompletenessSubject } from '../shared/completeness.js';
import type {
  Kit,
  MeasuredPair,
  ObjectKind,
  Observation,
  ObservingSession,
  Optics,
} from '../shared/types.js';
import { notFound } from './errors.js';

export interface SessionRow {
  id: string;
  site_id: string;
  site_name: string;
  time_zone: string;
  started_at: Date;
  optics: Optics;
  observation_count: number;
}

export interface ObservationRow {
  id: string;
  session_id: string;
  object_id: string;
  designation: string;
  object_name: string;
  kind: ObjectKind;
  observed_at: Date | null;
  seeing: number | null;
  transparency_nelm: number | null;
  concentration_class: string | null;
  pair: MeasuredPair | null;
  description: string;
  optics: Optics;
  strokes_sha256: string | null;
  strokes_size: number | null;
  strokes_has_marks: boolean;
  raster_sha256: string | null;
  version: number;
  created_seq: number;
  site_id: string;
  site_name: string;
  time_zone: string;
  started_at: Date;
}

const SESSION_COLUMNS = `
  s.id, s.site_id, si.name AS site_name, si.time_zone, s.started_at, s.optics,
  (SELECT count(*)::int FROM observations o
    WHERE o.session_id = s.id AND o.deleted = false) AS observation_count`;

const OBSERVATION_COLUMNS = `
  o.id, o.session_id, o.object_id, c.designation, c.name AS object_name, c.kind,
  o.observed_at, o.seeing, o.transparency_nelm, o.concentration_class, o.pair,
  o.description, o.optics, o.strokes_sha256, o.strokes_size, o.strokes_has_marks,
  o.raster_sha256, o.version, o.created_seq,
  s.site_id, si.name AS site_name, si.time_zone, s.started_at`;

const OBSERVATION_FROM = `
  FROM observations o
  JOIN observing_sessions s ON s.id = o.session_id
  JOIN sites si ON si.id = s.site_id
  JOIN catalogue_objects c ON c.id = o.object_id`;

export function toSession(row: SessionRow, kit: Kit): ObservingSession {
  const derived = deriveFromKit(kit, row.optics);
  if (!derived) throw new Error('a stored session always names kit it owns');
  return {
    id: row.id,
    site: { id: row.site_id, name: row.site_name, time_zone: row.time_zone },
    started_at: formatTimestamp(row.started_at),
    evening_date: eveningDate(row.started_at, row.time_zone),
    local_start: localClock(row.started_at, row.time_zone),
    local_start_offset: utcOffset(row.started_at, row.time_zone),
    optics: row.optics,
    derived,
    observation_count: row.observation_count,
  };
}

export function toObservation(row: ObservationRow, kit: Kit): Observation {
  const derived = deriveFromKit(kit, row.optics);
  if (!derived) throw new Error('a stored observation always names kit it owns');
  return {
    id: row.id,
    session_id: row.session_id,
    object_id: row.object_id,
    designation: row.designation,
    kind: row.kind,
    observed_at: row.observed_at ? formatTimestamp(row.observed_at) : null,
    local_time: row.observed_at ? localClock(row.observed_at, row.time_zone) : null,
    local_offset: row.observed_at ? utcOffset(row.observed_at, row.time_zone) : null,
    evening_date: eveningDate(row.started_at, row.time_zone),
    site: { id: row.site_id, name: row.site_name, time_zone: row.time_zone },
    seeing: row.seeing,
    transparency_nelm: row.transparency_nelm,
    concentration_class: row.concentration_class,
    pair: row.pair,
    description: row.description,
    optics: row.optics,
    derived,
    sketch:
      row.strokes_has_marks && row.strokes_sha256 !== null && row.strokes_size !== null
        ? {
            strokes_sha256: row.strokes_sha256,
            strokes_size: row.strokes_size,
            has_raster: row.raster_sha256 !== null,
          }
        : null,
    version: row.version,
  };
}

export function toCompletenessSubject(row: ObservationRow): CompletenessSubject {
  return {
    id: row.id,
    object_id: row.object_id,
    kind: row.kind,
    evening_date: eveningDate(row.started_at, row.time_zone),
    observed_at: row.observed_at ? formatTimestamp(row.observed_at) : null,
    seeing: row.seeing,
    transparency_nelm: row.transparency_nelm,
    concentration_class: row.concentration_class,
    has_pair: row.pair !== null,
    description: row.description,
    has_sketch: row.strokes_has_marks,
    sequence: row.created_seq,
  };
}

export async function readSessions(
  accountId: string,
  client: Queryable = pool,
): Promise<SessionRow[]> {
  const found = await client.query<SessionRow>(
    `SELECT ${SESSION_COLUMNS}
     FROM observing_sessions s JOIN sites si ON si.id = s.site_id
     WHERE s.account_id = $1 ORDER BY s.started_at DESC, s.created_seq DESC`,
    [accountId],
  );
  return found.rows;
}

export async function readSession(
  accountId: string,
  sessionId: string,
  client: Queryable = pool,
): Promise<SessionRow> {
  const found = await client.query<SessionRow>(
    `SELECT ${SESSION_COLUMNS}
     FROM observing_sessions s JOIN sites si ON si.id = s.site_id
     WHERE s.account_id = $1 AND s.id = $2`,
    [accountId, sessionId],
  );
  const row = found.rows[0];
  if (!row) throw notFound();
  return row;
}

export async function readObservations(
  accountId: string,
  client: Queryable = pool,
): Promise<ObservationRow[]> {
  const found = await client.query<ObservationRow>(
    `SELECT ${OBSERVATION_COLUMNS} ${OBSERVATION_FROM}
     WHERE o.account_id = $1 AND o.deleted = false
     ORDER BY o.observed_at NULLS LAST, o.created_seq`,
    [accountId],
  );
  return found.rows;
}

export async function readSessionObservations(
  accountId: string,
  sessionId: string,
  client: Queryable = pool,
): Promise<ObservationRow[]> {
  const found = await client.query<ObservationRow>(
    `SELECT ${OBSERVATION_COLUMNS} ${OBSERVATION_FROM}
     WHERE o.account_id = $1 AND o.session_id = $2 AND o.deleted = false
     ORDER BY o.observed_at NULLS LAST, o.created_seq`,
    [accountId, sessionId],
  );
  return found.rows;
}

/** History order: newest observed_at first, with observations that have no time last. */
export async function readObjectHistory(
  accountId: string,
  objectId: string,
  client: Queryable = pool,
): Promise<ObservationRow[]> {
  const found = await client.query<ObservationRow>(
    `SELECT ${OBSERVATION_COLUMNS} ${OBSERVATION_FROM}
     WHERE o.account_id = $1 AND o.object_id = $2 AND o.deleted = false
     ORDER BY o.observed_at DESC NULLS LAST, o.created_seq DESC`,
    [accountId, objectId],
  );
  return found.rows;
}

export async function readObservation(
  accountId: string,
  observationId: string,
  client: Queryable = pool,
): Promise<ObservationRow> {
  const row = await findObservation(accountId, observationId, client);
  if (!row) throw notFound();
  return row;
}

export async function findObservation(
  accountId: string,
  observationId: string,
  client: Queryable = pool,
): Promise<ObservationRow | null> {
  const found = await client.query<ObservationRow>(
    `SELECT ${OBSERVATION_COLUMNS} ${OBSERVATION_FROM}
     WHERE o.account_id = $1 AND o.id = $2 AND o.deleted = false`,
    [accountId, observationId],
  );
  return found.rows[0] ?? null;
}
