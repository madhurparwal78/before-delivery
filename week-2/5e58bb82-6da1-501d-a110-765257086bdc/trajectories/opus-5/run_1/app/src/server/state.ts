import type {
  Counters,
  CrosslineAgreement,
  Holiday,
  Line,
  Mission,
  MissionSummary,
  Position,
  Role,
  Track,
} from '../shared/types.js';
import type { Db } from './db.js';
import { newId } from './db.js';
import {
  cellPairs,
  computeCoverage,
  findHolidayGroups,
  groupCentroid,
  lineCounts,
  type CoverageFix,
  type CoverageLine,
  type CoverageResult,
  type MissionGeometry,
} from './domain/coverage.js';
import { matchHolidayLabels, type ExistingHoliday } from './domain/holidayLabels.js';
import { infillGeometry, isEligible, midpoint, nearestEligible, type InfillCandidate } from './domain/infill.js';
import { decideLinkState } from './domain/linkState.js';
import { projectHoliday, projectMission } from './domain/projection.js';
import { isMissionActive, lineRemaining } from './domain/transitions.js';
import {
  findMission,
  isoOf,
  isoOrNull,
  latestFix,
  listFixesForMission,
  listHolidays,
  listLines,
  listVessels,
  runningLineOfVessel,
  toHoliday,
  toLine,
  type FixRow,
  type HolidayRow,
  type LineRow,
  type MissionRow,
  type OrgRow,
  type VesselRow,
} from './repo.js';
import { findOrg } from './repo.js';

export interface MissionState {
  mission: MissionRow;
  org: OrgRow;
  lines: LineRow[];
  holidays: HolidayRow[];
  coverage: CoverageResult;
  counters: Counters;
  agreement: CrosslineAgreement;
  /** Vessels holding lines on this mission, in seed order. */
  missionVessels: VesselRow[];
  vesselNames: Map<string, string>;
  lastFixes: Map<string, FixRow | null>;
  runningLines: Map<string, string | null>;
  now: Date;
}

export function missionGeometry(mission: MissionRow): MissionGeometry {
  return {
    survey_area: mission.survey_area,
    geofence: mission.geofence,
    line_azimuth_deg: mission.line_azimuth_deg,
    swath_ratio: mission.swath_ratio,
    planned_speed_mps: mission.planned_speed_mps,
    survey_order: mission.survey_order,
  };
}

export function coverageLines(lines: LineRow[]): CoverageLine[] {
  return lines.map((line) => ({
    id: line.id,
    kind: line.kind,
    status: line.status,
    rerun_of: line.rerun_of,
    start: { easting: line.start_e, northing: line.start_n },
    end: { easting: line.end_e, northing: line.end_n },
    length_m: line.length_m,
  }));
}

function coverageFixes(fixes: FixRow[]): CoverageFix[] {
  return fixes.map((fix) => ({
    vessel_id: fix.vessel_id,
    line_id: fix.line_id,
    t: new Date(fix.t).getTime() / 1000,
    easting: fix.easting,
    northing: fix.northing,
    heading_deg: fix.heading_deg,
    speed_mps: fix.speed_mps,
    depth_m: fix.depth_m,
  }));
}

/** Loads a mission with every derived value decided once. */
export async function loadMissionState(
  db: Db,
  missionId: string,
  now: Date,
): Promise<MissionState | null> {
  const mission = await findMission(db, missionId);
  if (!mission) return null;
  const org = await findOrg(db, mission.client_org_id);
  if (!org) return null;
  const [lines, holidays, fixes, vessels] = await Promise.all([
    listLines(db, missionId),
    listHolidays(db, missionId),
    listFixesForMission(db, missionId),
    listVessels(db),
  ]);

  const coverage = computeCoverage(missionGeometry(mission), coverageLines(lines), coverageFixes(fixes));

  const vesselIds = new Set(lines.map((line) => line.vessel_id).filter((id): id is string => id !== null));
  const missionVessels = vessels.filter((vessel) => vesselIds.has(vessel.id));
  const lastFixes = new Map<string, FixRow | null>();
  const runningLines = new Map<string, string | null>();
  for (const vessel of missionVessels) {
    lastFixes.set(vessel.id, await latestFix(db, vessel.id));
    const running = await runningLineOfVessel(db, vessel.id);
    runningLines.set(vessel.id, running ? running.id : null);
  }

  return {
    mission,
    org,
    lines,
    holidays,
    coverage,
    counters: {
      coverage_pct: coverage.coveragePct,
      open_holidays: holidays.filter((holiday) => holiday.status === 'Open').length,
      lines_remaining: lines.filter((line) => lineRemaining(line.status)).length,
    },
    agreement: coverage.crosslineAgreement,
    missionVessels,
    vesselNames: new Map(vessels.map((vessel) => [vessel.id, vessel.name])),
    lastFixes,
    runningLines,
    now,
  };
}

/**
 * Recomputes the mission's holidays after an accepted fix or a line end, keeping
 * labels stable through the matching rule and never reusing a label.
 */
export async function recomputeHolidays(db: Db, missionId: string): Promise<void> {
  const mission = await findMission(db, missionId);
  if (!mission) return;
  const [lines, stored, fixes] = await Promise.all([
    listLines(db, missionId),
    listHolidays(db, missionId),
    listFixesForMission(db, missionId),
  ]);
  const geometry = missionGeometry(mission);
  const coverage = computeCoverage(geometry, coverageLines(lines), coverageFixes(fixes));
  const groups = findHolidayGroups(geometry, coverageLines(lines), coverage.grid).filter(
    (group) => group.qualifies,
  );

  const existing: ExistingHoliday[] = stored
    .filter((holiday) => holiday.status === 'Open' || holiday.status === 'Queued')
    .map((holiday) => ({
      id: holiday.id,
      label: holiday.label,
      label_num: holiday.label_num,
      cells: holiday.cells,
    }));

  const { matches, closed } = matchHolidayLabels(groups, existing);
  const byId = new Map(stored.map((holiday) => [holiday.id, holiday]));
  const lineStatus = new Map(lines.map((line) => [line.id, line.status]));
  let nextNumber = mission.next_holiday_num;

  const statusFor = (infillLineId: string | null): 'Open' | 'Queued' => {
    if (infillLineId === null) return 'Open';
    const status = lineStatus.get(infillLineId);
    return status === 'Assigned' || status === 'Running' ? 'Queued' : 'Open';
  };

  for (const match of matches) {
    const cells = groups[match.groupIndex]!.cells;
    if (match.existing) {
      const row = byId.get(match.existing.id)!;
      await db.query('UPDATE holidays SET cells = $2, status = $3 WHERE id = $1', [
        row.id,
        JSON.stringify(cells),
        statusFor(row.infill_line_id),
      ]);
    } else {
      const label = `H${nextNumber}`;
      await db.query(
        `INSERT INTO holidays (id, mission_id, label, label_num, status, cells, infill_line_id)
         VALUES ($1,$2,$3,$4,'Open',$5,NULL)`,
        [newId('hol'), missionId, label, nextNumber, JSON.stringify(cells)],
      );
      nextNumber += 1;
    }
  }

  for (const holiday of closed) {
    await db.query(`UPDATE holidays SET status = 'Closed' WHERE id = $1`, [holiday.id]);
  }

  if (nextNumber !== mission.next_holiday_num) {
    await db.query('UPDATE missions SET next_holiday_num = $2 WHERE id = $1', [
      missionId,
      nextNumber,
    ]);
  }
}

/** The candidates for infill eligibility on this mission. */
export function infillCandidates(state: MissionState): InfillCandidate[] {
  return state.missionVessels.map((vessel) => {
    const fix = state.lastFixes.get(vessel.id) ?? null;
    return {
      id: vessel.id,
      name: vessel.name,
      afloat: vessel.afloat,
      link_state: decideLinkState(fix ? fix.received_at : null, state.now),
      hours_since_service: vessel.hours_since_service,
      service_interval_h: vessel.service_interval_h,
      hasLinesOnMission: true,
      lastFix: fix ? { easting: fix.easting, northing: fix.northing } : null,
    } satisfies InfillCandidate;
  });
}

export function holidayCentroid(state: MissionState, cells: number[]): Position {
  return groupCentroid(state.coverage.grid, cells);
}

/** The nearest eligible vessel for a holiday, by the infill line's midpoint. */
export function nearestForHoliday(state: MissionState, cells: number[]): InfillCandidate | null {
  const geometry = infillGeometry(
    state.mission.survey_area,
    state.mission.line_azimuth_deg,
    state.coverage.grid,
    cells,
  );
  const target = geometry
    ? midpoint(geometry.start, geometry.end)
    : holidayCentroid(state, cells);
  return nearestEligible(infillCandidates(state), target);
}

export function holidayRecords(state: MissionState, role: Role): Holiday[] {
  return state.holidays.map((row) => {
    const nearest = row.status === 'Closed' ? null : nearestForHoliday(state, row.cells);
    return projectHoliday(
      toHoliday(
        row,
        cellPairs(state.coverage.grid, row.cells),
        holidayCentroid(state, row.cells),
        nearest ? { id: nearest.id, name: nearest.name } : null,
      ),
      role,
    );
  });
}

export function lineRecords(state: MissionState): Line[] {
  return state.lines.map((row) =>
    toLine(
      row,
      row.vessel_id ? state.vesselNames.get(row.vessel_id) ?? null : null,
      state.coverage.coveredByLine.get(row.id) ?? 0,
    ),
  );
}

export function missionRecord(state: MissionState, role: Role): Mission {
  const mission = state.mission;
  const record: Mission = {
    id: mission.id,
    name: mission.name,
    client_org_id: mission.client_org_id,
    client_name: state.org.name,
    survey_date: mission.survey_date,
    status: mission.status,
    survey_order: mission.survey_order,
    survey_area: mission.survey_area,
    geofence: mission.geofence,
    planned_depth_m: mission.planned_depth_m,
    swath_ratio: mission.swath_ratio,
    overlap_pct: mission.overlap_pct,
    line_azimuth_deg: mission.line_azimuth_deg,
    planned_speed_mps: mission.planned_speed_mps,
    swath_width_m: mission.swath_width_m,
    line_spacing_m: mission.line_spacing_m,
    line_count: mission.line_count,
    crossline_count: mission.crossline_count,
    estimated_duration_s: mission.estimated_duration_s,
    counters: state.counters,
    crossline_agreement: state.agreement,
    vessels: state.missionVessels.map((vessel) => {
      const fix = state.lastFixes.get(vessel.id) ?? null;
      return {
        id: vessel.id,
        name: vessel.name,
        link_state: decideLinkState(fix ? fix.received_at : null, state.now),
      };
    }),
    report: { state: mission.report_state },
    owner_id: mission.owner_id,
    owner_name: '',
    version: mission.version,
    hold: mission.hold,
    created_at: isoOf(mission.created_at),
    launched_at: isoOrNull(mission.launched_at),
    completed_at: isoOrNull(mission.completed_at),
  };
  return projectMission(record, role);
}

export function missionSummary(mission: MissionRow, orgName: string, counters: Counters): MissionSummary {
  return {
    id: mission.id,
    name: mission.name,
    client_org_id: mission.client_org_id,
    client_name: orgName,
    survey_date: mission.survey_date,
    status: mission.status,
    counters,
  };
}

/** A line's track is every accepted fix received while that line was Running. */
export async function missionTracks(db: Db, state: MissionState): Promise<Track[]> {
  const fixes = await listFixesForMission(db, state.mission.id);
  const byLine = new Map<string, FixRow[]>();
  for (const fix of fixes) {
    if (fix.line_id === null) continue;
    const list = byLine.get(fix.line_id);
    if (list) list.push(fix);
    else byLine.set(fix.line_id, [fix]);
  }
  return state.lines
    .filter((line) => byLine.has(line.id))
    .map((line) => {
      const points = (byLine.get(line.id) ?? []).slice().sort((a, b) => +new Date(a.t) - +new Date(b.t));
      return {
        line_id: line.id,
        label: line.label,
        vessel_id: points[0]?.vessel_id ?? line.vessel_id ?? '',
        points: points.map((fix) => ({
          t: isoOf(fix.t),
          easting: fix.easting,
          northing: fix.northing,
          depth_m: fix.depth_m,
          swath_m: fix.depth_m * state.mission.swath_ratio,
        })),
      } satisfies Track;
    });
}

export function missionIsActive(state: MissionState): boolean {
  return isMissionActive(state.mission.status);
}

export function eligibleVesselIds(state: MissionState): Set<string> {
  return new Set(
    infillCandidates(state)
      .filter((candidate) => isEligible(candidate))
      .map((candidate) => candidate.id),
  );
}

export function countingLineIds(state: MissionState): Set<string> {
  return new Set(
    coverageLines(state.lines)
      .filter((line) => lineCounts(line))
      .map((line) => line.id),
  );
}

export type { HolidayRow };
