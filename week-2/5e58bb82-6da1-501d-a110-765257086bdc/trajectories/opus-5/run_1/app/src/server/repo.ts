import { roundHalfUp } from '../shared/numbers.js';
import type {
  Alert,
  AlertHistoryEntry,
  AlertKind,
  AlertState,
  FileState,
  Holiday,
  Line,
  LineKind,
  LineStatus,
  MissionStatus,
  Position,
  Role,
  ServiceEntry,
  SurveyOrder,
  Units,
  User,
  Vessel,
} from '../shared/types.js';
import type { Db } from './db.js';
import { decideLinkState } from './domain/linkState.js';
import { isOverdue } from './domain/overdue.js';
import { isMissionOpen } from './domain/transitions.js';

export interface UserRow {
  id: string;
  name: string;
  email: string;
  role: Role;
  client_org_id: string | null;
  units: Units;
  password_hash: string;
  last_screen: string | null;
}

export interface OrgRow {
  id: string;
  name: string;
  time_zone: string;
}

export interface VesselRow {
  id: string;
  name: string;
  ingest_key: string;
  thruster_hours_total: number;
  hours_since_service: number;
  service_interval_h: number;
  afloat: boolean;
  version: number;
  seed_order: number;
}

export interface MissionRow {
  id: string;
  name: string;
  client_org_id: string;
  survey_date: string;
  status: MissionStatus;
  survey_order: SurveyOrder;
  survey_area: Position[];
  geofence: Position[];
  planned_depth_m: number;
  swath_ratio: number;
  overlap_pct: number;
  line_azimuth_deg: number;
  planned_speed_mps: number;
  swath_width_m: number;
  line_spacing_m: number;
  line_count: number;
  crossline_count: number;
  estimated_duration_s: number;
  owner_id: string;
  version: number;
  hold: { reason: string; since: string; by: string } | null;
  report_state: 'None' | 'Pending' | 'Ready';
  report_sha256: string | null;
  report_size_bytes: number | null;
  report_stored_at: string | null;
  report_generated_at: string | null;
  created_at: string;
  launched_at: string | null;
  completed_at: string | null;
  next_label_num: number;
  next_holiday_num: number;
}

export interface LineRow {
  id: string;
  mission_id: string;
  label: string;
  kind: LineKind;
  status: LineStatus;
  rerun_of: string | null;
  rerun_seq: number;
  vessel_id: string | null;
  start_e: number;
  start_n: number;
  end_e: number;
  end_n: number;
  length_m: number;
  holiday_id: string | null;
  label_num: number;
  infill_order: number | null;
  file_state: FileState | null;
  file_name: string | null;
  file_size: number | null;
  file_sha256: string | null;
  file_stored_at: string | null;
}

export interface HolidayRow {
  id: string;
  mission_id: string;
  label: string;
  label_num: number;
  status: 'Open' | 'Queued' | 'Closed';
  cells: number[];
  infill_line_id: string | null;
}

export interface AlertRow {
  id: string;
  mission_id: string;
  vessel_id: string;
  kind: AlertKind;
  state: AlertState;
  heading: string;
  raised_at: string;
  rectified_at: string | null;
  position: Position | null;
  acknowledged_at: string | null;
  acknowledged_by: string | null;
  email_state: 'Queued' | 'Emailed';
  escalation_state: 'None' | 'Queued' | 'Emailed';
  history: AlertHistoryEntry[];
  seq: string;
}

export interface FixRow {
  id: string;
  vessel_id: string;
  t: Date;
  received_at: Date;
  easting: number;
  northing: number;
  heading_deg: number;
  speed_mps: number;
  battery_pct: number;
  depth_m: number;
  line_id: string | null;
  mission_id: string | null;
}

/** Ordering key so that re-runs list right after their original. */
const LINE_ORDER = `CASE kind WHEN 'planned' THEN 0 WHEN 'crossline' THEN 1 ELSE 2 END, label_num, rerun_seq`;

export async function findUserByEmail(db: Db, email: string): Promise<UserRow | null> {
  const result = await db.query<UserRow>(
    'SELECT * FROM users WHERE lower(email) = lower($1) LIMIT 1',
    [email.trim()],
  );
  return result.rows[0] ?? null;
}

export async function findUserById(db: Db, id: string): Promise<UserRow | null> {
  const result = await db.query<UserRow>('SELECT * FROM users WHERE id = $1', [id]);
  return result.rows[0] ?? null;
}

export async function usersByRole(db: Db, roles: Role[]): Promise<UserRow[]> {
  const result = await db.query<UserRow>(
    'SELECT * FROM users WHERE role = ANY($1) ORDER BY seed_order',
    [roles],
  );
  return result.rows;
}

export async function reviewersOfOrg(db: Db, orgId: string): Promise<UserRow[]> {
  const result = await db.query<UserRow>(
    `SELECT * FROM users WHERE role = 'client_reviewer' AND client_org_id = $1 ORDER BY seed_order`,
    [orgId],
  );
  return result.rows;
}

export async function listOrgs(db: Db): Promise<OrgRow[]> {
  const result = await db.query<OrgRow>(
    'SELECT id, name, time_zone FROM client_orgs ORDER BY seed_order',
  );
  return result.rows;
}

export async function findOrg(db: Db, id: string): Promise<OrgRow | null> {
  const result = await db.query<OrgRow>(
    'SELECT id, name, time_zone FROM client_orgs WHERE id = $1',
    [id],
  );
  return result.rows[0] ?? null;
}

export async function listVessels(db: Db): Promise<VesselRow[]> {
  const result = await db.query<VesselRow>('SELECT * FROM vessels ORDER BY seed_order');
  return result.rows;
}

export async function findVessel(db: Db, id: string): Promise<VesselRow | null> {
  const result = await db.query<VesselRow>('SELECT * FROM vessels WHERE id = $1', [id]);
  return result.rows[0] ?? null;
}

export async function findVesselByIngestKey(db: Db, key: string): Promise<VesselRow | null> {
  const result = await db.query<VesselRow>('SELECT * FROM vessels WHERE ingest_key = $1', [key]);
  return result.rows[0] ?? null;
}

export async function findMission(db: Db, id: string): Promise<MissionRow | null> {
  const result = await db.query<MissionRow>(
    `SELECT m.*, to_char(m.survey_date, 'YYYY-MM-DD') AS survey_date FROM missions m WHERE m.id = $1`,
    [id],
  );
  return result.rows[0] ?? null;
}

/** Newest survey date first, then the name lower-cased, then the id. */
export async function listMissions(db: Db, orgId: string | null): Promise<MissionRow[]> {
  const result = await db.query<MissionRow>(
    `SELECT m.*, to_char(m.survey_date, 'YYYY-MM-DD') AS survey_date FROM missions m
     WHERE $1::text IS NULL OR m.client_org_id = $1
     ORDER BY m.survey_date DESC, lower(m.name), m.id`,
    [orgId],
  );
  return result.rows;
}

export async function listLines(db: Db, missionId: string): Promise<LineRow[]> {
  const result = await db.query<LineRow>(
    `SELECT * FROM lines WHERE mission_id = $1 ORDER BY ${LINE_ORDER}`,
    [missionId],
  );
  return result.rows;
}

export async function findLine(db: Db, id: string): Promise<LineRow | null> {
  const result = await db.query<LineRow>('SELECT * FROM lines WHERE id = $1', [id]);
  return result.rows[0] ?? null;
}

export async function listHolidays(db: Db, missionId: string): Promise<HolidayRow[]> {
  const result = await db.query<HolidayRow>(
    'SELECT * FROM holidays WHERE mission_id = $1 ORDER BY label_num',
    [missionId],
  );
  return result.rows;
}

export async function listFixesForMission(db: Db, missionId: string): Promise<FixRow[]> {
  const result = await db.query<FixRow>(
    'SELECT * FROM fixes WHERE mission_id = $1 ORDER BY vessel_id, t',
    [missionId],
  );
  return result.rows;
}

export async function latestFix(db: Db, vesselId: string): Promise<FixRow | null> {
  const result = await db.query<FixRow>(
    'SELECT * FROM fixes WHERE vessel_id = $1 ORDER BY t DESC LIMIT 1',
    [vesselId],
  );
  return result.rows[0] ?? null;
}

export async function recentFixes(
  db: Db,
  vesselId: string,
  windowSeconds: number | null,
): Promise<FixRow[]> {
  if (windowSeconds === null) {
    const result = await db.query<FixRow>(
      'SELECT * FROM fixes WHERE vessel_id = $1 ORDER BY t DESC LIMIT 20',
      [vesselId],
    );
    return result.rows;
  }
  const result = await db.query<FixRow>(
    `SELECT * FROM fixes WHERE vessel_id = $1
       AND t >= (SELECT max(t) FROM fixes WHERE vessel_id = $1) - make_interval(secs => $2)
     ORDER BY t DESC`,
    [vesselId, windowSeconds],
  );
  return result.rows;
}

/** The single open mission a vessel holds lines on, if any. */
export async function openMissionOfVessel(db: Db, vesselId: string): Promise<MissionRow | null> {
  const result = await db.query<MissionRow>(
    `SELECT m.*, to_char(m.survey_date, 'YYYY-MM-DD') AS survey_date FROM missions m
     WHERE m.status IN ('Planned','Launched','Surveying','Recovering')
       AND EXISTS (SELECT 1 FROM lines l WHERE l.mission_id = m.id AND l.vessel_id = $1)
     LIMIT 1`,
    [vesselId],
  );
  return result.rows[0] ?? null;
}

export async function runningLineOfVessel(db: Db, vesselId: string): Promise<LineRow | null> {
  const result = await db.query<LineRow>(
    `SELECT * FROM lines WHERE vessel_id = $1 AND status = 'Running' LIMIT 1`,
    [vesselId],
  );
  return result.rows[0] ?? null;
}

export async function listAlerts(db: Db, onlyOpen: boolean): Promise<AlertRow[]> {
  const result = await db.query<AlertRow>(
    `SELECT * FROM alerts ${onlyOpen ? `WHERE state <> 'Closed'` : ''} ORDER BY raised_at DESC, seq DESC`,
    [],
  );
  return result.rows;
}

export async function findAlert(db: Db, id: string): Promise<AlertRow | null> {
  const result = await db.query<AlertRow>('SELECT * FROM alerts WHERE id = $1', [id]);
  return result.rows[0] ?? null;
}

export async function listServices(db: Db, vesselId: string): Promise<ServiceEntry[]> {
  const result = await db.query<ServiceEntry>(
    `SELECT id, vessel_id, logged_at, logged_by, hours_at_service, note
     FROM services WHERE vessel_id = $1 ORDER BY logged_at DESC`,
    [vesselId],
  );
  return result.rows.map((row) => ({ ...row, logged_at: isoOf(row.logged_at) }));
}

function isoOf(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

function isoOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return isoOf(value);
}

export function hours(value: number): number {
  return roundHalfUp(value, 3);
}

export interface VesselContext {
  openMissionId: string | null;
  runningLineId: string | null;
  lastFix: FixRow | null;
}

export function toVessel(row: VesselRow, context: VesselContext, now: Date): Vessel {
  const lastFix = context.lastFix;
  return {
    id: row.id,
    name: row.name,
    version: row.version,
    link_state: decideLinkState(lastFix ? lastFix.received_at : null, now),
    last_fix_received_at: lastFix ? isoOf(lastFix.received_at) : null,
    last_fix: lastFix
      ? {
          t: isoOf(lastFix.t),
          position: { easting: lastFix.easting, northing: lastFix.northing },
          heading_deg: lastFix.heading_deg,
          speed_mps: lastFix.speed_mps,
          battery_pct: lastFix.battery_pct,
          depth_m: lastFix.depth_m,
        }
      : null,
    afloat: row.afloat,
    mission_id: context.openMissionId,
    running_line_id: context.runningLineId,
    thruster_hours_total: hours(row.thruster_hours_total),
    hours_since_service: hours(row.hours_since_service),
    service_interval_h: row.service_interval_h,
    service_overdue: isOverdue(row.hours_since_service, row.service_interval_h),
  };
}

/** Builds the vessel records for a whole fleet in one pass. */
export async function vesselRecords(db: Db, now: Date): Promise<Vessel[]> {
  const rows = await listVessels(db);
  const contexts = await Promise.all(
    rows.map(async (row) => {
      const [mission, running, fix] = await Promise.all([
        openMissionOfVessel(db, row.id),
        runningLineOfVessel(db, row.id),
        latestFix(db, row.id),
      ]);
      return {
        openMissionId: mission ? mission.id : null,
        runningLineId: running ? running.id : null,
        lastFix: fix,
      } satisfies VesselContext;
    }),
  );
  return rows.map((row, index) => toVessel(row, contexts[index]!, now));
}

export function toLine(row: LineRow, vesselName: string | null, coveredM: number): Line {
  return {
    id: row.id,
    mission_id: row.mission_id,
    label: row.label,
    kind: row.kind,
    status: row.status,
    rerun_of: row.rerun_of,
    vessel_id: row.vessel_id,
    vessel_name: vesselName,
    start: { easting: row.start_e, northing: row.start_n },
    end: { easting: row.end_e, northing: row.end_n },
    length_m: row.length_m,
    covered_m: coveredM,
    holiday_id: row.holiday_id,
    file:
      row.file_state === null
        ? null
        : {
            state: row.file_state,
            name: row.file_name,
            size_bytes: row.file_size,
            sha256: row.file_sha256,
            stored_at: isoOrNull(row.file_stored_at),
          },
  };
}

export function toAlert(row: AlertRow, vesselName: string): Alert {
  return {
    id: row.id,
    kind: row.kind,
    state: row.state,
    heading: row.heading,
    vessel_id: row.vessel_id,
    vessel_name: vesselName,
    mission_id: row.mission_id,
    raised_at: isoOf(row.raised_at),
    rectified_at: isoOrNull(row.rectified_at),
    position: row.position,
    acknowledged_at: isoOrNull(row.acknowledged_at),
    acknowledged_by: row.acknowledged_by,
    email: row.email_state,
    escalation: row.escalation_state,
    history: row.history,
  };
}

export function toHoliday(
  row: HolidayRow,
  cells: [number, number][],
  centroid: Position,
  nearest: { id: string; name: string } | null,
): Holiday {
  return {
    id: row.id,
    label: row.label,
    status: row.status,
    area_m2: row.cells.length * 25,
    cell_count: row.cells.length,
    centroid,
    cells,
    nearest_vessel: nearest,
    infill_line_id: row.infill_line_id,
  };
}

export function toUser(row: UserRow): User {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    client_org_id: row.client_org_id,
    units: row.units,
  };
}

export function missionIsOpenRow(row: MissionRow): boolean {
  return isMissionOpen(row.status);
}

export { isoOf, isoOrNull };
