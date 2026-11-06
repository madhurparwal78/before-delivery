import { fromString, round, type Dec } from '../domain/decimal';
import type { ProjectShape, Reading, Sensor, SensorKind } from '../domain/derivation';
import { compareSensorIds } from '../domain/derivation';
import type { Ring } from '../domain/geometry';
import { HALF_HOUR_MS } from '../domain/time';
import type { Queryable } from './db/queryable';
import type { OrgRole, ProjectRole } from './db/seed-data';

export interface Project {
  readonly slug: string;
  readonly name: string;
  readonly kind: string;
  readonly code: string;
  readonly floorPct: Dec;
  readonly bufferPct: Dec;
  readonly leadPersonId: string;
  readonly boundary: Ring;
  readonly boundaryAreaM2: bigint;
  readonly sensors: readonly Sensor[];
}

export interface Person {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly orgRole: OrgRole;
}

const ROLE_RANK: Record<ProjectRole, number> = { viewer: 1, analyst: 2, sealer: 3 };

export function atLeast(role: ProjectRole, needed: ProjectRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[needed];
}

export function shapeOf(project: Project): ProjectShape {
  return {
    boundary: project.boundary,
    boundaryAreaM2: project.boundaryAreaM2,
    sensors: project.sensors,
    floorPct: project.floorPct,
    bufferPct: project.bufferPct,
  };
}

interface ProjectRow {
  slug: string;
  name: string;
  kind: string;
  code: string;
  floor_pct: string;
  buffer_pct: string;
  lead_person_id: string;
  boundary: Ring;
  boundary_area_m2: string;
}

interface SensorRow {
  project_slug: string;
  id: string;
  kind: SensorKind;
  polygon: Ring;
}

async function buildProjects(executor: Queryable, rows: ProjectRow[]): Promise<Project[]> {
  if (rows.length === 0) return [];
  const sensors = await executor.query<SensorRow>(
    'select project_slug, id, kind, polygon from sensors where project_slug = any($1)',
    [rows.map((row) => row.slug)],
  );
  return rows.map((row) => ({
    slug: row.slug,
    name: row.name,
    kind: row.kind,
    code: row.code,
    floorPct: fromString(row.floor_pct),
    bufferPct: fromString(row.buffer_pct),
    leadPersonId: row.lead_person_id,
    boundary: row.boundary,
    boundaryAreaM2: BigInt(row.boundary_area_m2),
    sensors: sensors.rows
      .filter((sensor) => sensor.project_slug === row.slug)
      .map((sensor) => ({ id: sensor.id, kind: sensor.kind, polygon: sensor.polygon }))
      .sort((a, b) => compareSensorIds(a.id, b.id)),
  }));
}

export async function loadProject(executor: Queryable, slug: string): Promise<Project | null> {
  const result = await executor.query<ProjectRow>(
    `select slug, name, kind, code, floor_pct, buffer_pct, lead_person_id, boundary,
            boundary_area_m2 from projects where slug = $1`,
    [slug],
  );
  const projects = await buildProjects(executor, result.rows);
  return projects[0] ?? null;
}

export async function loadAllProjects(executor: Queryable): Promise<Project[]> {
  const result = await executor.query<ProjectRow>(
    `select slug, name, kind, code, floor_pct, buffer_pct, lead_person_id, boundary,
            boundary_area_m2 from projects order by name`,
  );
  return buildProjects(executor, result.rows);
}

export async function loadGrants(
  executor: Queryable,
  personId: string,
): Promise<Map<string, ProjectRole>> {
  const result = await executor.query<{ project_slug: string; role: ProjectRole }>(
    'select project_slug, role from project_grants where person_id = $1',
    [personId],
  );
  return new Map(result.rows.map((row) => [row.project_slug, row.role]));
}

/**
 * The caller's effective role, read from grants on every request. An admin holds the higher
 * of viewer and their grant; anyone else without a grant cannot see the project at all.
 */
export function effectiveRole(person: Person, grant: ProjectRole | undefined): ProjectRole | null {
  if (person.orgRole === 'admin') {
    return grant !== undefined && ROLE_RANK[grant] > ROLE_RANK.viewer ? grant : 'viewer';
  }
  return grant ?? null;
}

export function scaled4(text: string): bigint {
  return round(fromString(text), 4).units;
}

interface ReadingRow {
  sensor_id: string;
  interval_start: Date;
  fc: string;
  fch4: string;
  qc: number;
}

export async function loadReadings(
  executor: Queryable,
  slug: string,
  sensorIds: readonly string[],
  startMs: number,
  endMs: number,
): Promise<Reading[]> {
  const result = await executor.query<ReadingRow>(
    `select sensor_id, interval_start, fc, fch4, qc from readings
     where project_slug = $1 and sensor_id = any($2)
       and interval_start >= $3 and interval_start < $4`,
    [slug, [...sensorIds], new Date(startMs).toISOString(), new Date(endMs).toISOString()],
  );
  return result.rows.map((row) => ({
    sensorId: row.sensor_id,
    intervalStartMs: row.interval_start.getTime(),
    fc4: scaled4(row.fc),
    fch44: scaled4(row.fch4),
    qc: row.qc,
  }));
}

export interface RecordBounds {
  readonly startMs: number | null;
  readonly endMs: number | null;
}

export async function loadRecordBounds(
  executor: Queryable,
  slug: string,
): Promise<RecordBounds> {
  const result = await executor.query<{ first: Date | null; last: Date | null }>(
    'select min(interval_start) as first, max(interval_start) as last from readings where project_slug = $1',
    [slug],
  );
  const row = result.rows[0];
  if (row === undefined || row.first === null || row.last === null) {
    return { startMs: null, endMs: null };
  }
  return { startMs: row.first.getTime(), endMs: row.last.getTime() + HALF_HOUR_MS };
}
