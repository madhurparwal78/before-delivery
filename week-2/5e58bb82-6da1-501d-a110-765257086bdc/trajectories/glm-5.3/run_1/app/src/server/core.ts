import type pg from 'pg';
import { newId, apiError } from './http.js';
import {
  Position, SurveyOrder, CELL_SIZE, cellCentre, gridSpec, areaCells,
  holidayQualifies, linkStateFromAge, LinkState, roundHalfUp,
  sweepsSwath, swathCells, withinUncertainty,
} from './domain.js';
import { emailOutbox } from './mail.js';

// ---------------- types ----------------

export interface VesselRow {
  id: string; name: string; version: number; afloat: boolean;
  thruster_hours_total: number; hours_since_service: number; service_interval_h: number;
  last_fix: FixRow | null; link_state: LinkState;
}

export interface FixRow {
  t: Date; received_at: Date; easting: number; northing: number;
  heading_deg: number; speed_mps: number; battery_pct: number; depth_m: number; line_id: string | null;
}

// ---------------- helpers ----------------

export function jpos(p: Position): string { return JSON.stringify(p); }

export function rowToFix(r: Record<string, unknown>): FixRow {
  return {
    t: new Date(r.t as string), received_at: new Date(r.received_at as string),
    easting: r.easting as number, northing: r.northing as number,
    heading_deg: r.heading_deg as number, speed_mps: r.speed_mps as number,
    battery_pct: r.battery_pct as number, depth_m: r.depth_m as number,
    line_id: (r.line_id as string | null) ?? null,
  };
}

export async function loadVessel(c: pg.PoolClient, id: string): Promise<{ v: VesselRow; lastFix: FixRow | null } | null> {
  const vr = await c.query(`SELECT * FROM vessels WHERE id = $1`, [id]);
  if (vr.rows.length === 0) return null;
  const v = vr.rows[0]!;
  const fr = await c.query(`SELECT * FROM fixes WHERE vessel_id = $1 ORDER BY t DESC LIMIT 1`, [id]);
  const lastFix = fr.rows.length ? rowToFix(fr.rows[0]!) : null;
  const receivedAt = lastFix ? new Date(lastFix.received_at) : null;
  const link: LinkState = receivedAt ? linkStateFromAge((Date.now() - receivedAt.getTime()) / 1000) : 'Lost';
  return {
    v: {
      id: v.id, name: v.name, version: v.version, afloat: v.afloat,
      thruster_hours_total: v.thruster_hours_total, hours_since_service: v.hours_since_service,
      service_interval_h: v.service_interval_h,
      last_fix: lastFix, link_state: link,
    },
    lastFix,
  };
}

export async function recordEvent(c: pg.PoolClient, missionId: string, kind: string, actor: string, summary: string): Promise<void> {
  await c.query(`INSERT INTO mission_events (mission_id, at, kind, actor, summary) VALUES ($1, now(), $2, $3, $4)`,
    [missionId, kind, actor, summary]);
}

// ---------------- mission transitions ----------------

export type MissionStatus = 'Planned' | 'Launched' | 'Surveying' | 'Recovering' | 'Complete' | 'Aborted';
export const OPEN_STATUSES: MissionStatus[] = ['Planned', 'Launched', 'Surveying', 'Recovering'];
export const ACTIVE_STATUSES: MissionStatus[] = ['Launched', 'Surveying', 'Recovering'];

export function isMissionOpen(s: string): boolean { return OPEN_STATUSES.includes(s as MissionStatus); }
export function isMissionActive(s: string): boolean { return ACTIVE_STATUSES.includes(s as MissionStatus); }

export function illegalTransition(from: string, to: string): ReturnType<typeof apiError> {
  return apiError(409, 'illegal_transition', `This mission cannot move from ${from} to ${to}`, { from, to });
}

// ---------------- alerts ----------------

export type AlertKind = 'geofence_breach' | 'link_lost' | 'service_overdue';
export type AlertState = 'Active' | 'Acknowledged' | 'Rectified' | 'Closed';

export function alertHeading(kind: AlertKind, vessel: string): string {
  if (kind === 'geofence_breach') return `Geofence breach — ${vessel}`;
  if (kind === 'link_lost') return `Link lost — ${vessel}`;
  return `Service overdue — ${vessel}`;
}

export async function raiseAlert(
  c: pg.PoolClient, kind: AlertKind, vessel: { id: string; name: string }, missionId: string,
  position: Position | null, actorTime: Date,
): Promise<string> {
  const id = newId('al');
  const heading = alertHeading(kind, vessel.name);
  await c.query(
    `INSERT INTO alerts (id, kind, state, heading, vessel_id, mission_id, raised_at, position, email, escalation, condition)
     VALUES ($1,$2,'Active',$3,$4,$5,$6,$7,'Queued','None',$8)`,
    [id, kind, heading, vessel.id, missionId, actorTime, position ? jpos(position) : null, kind]
  );
  await c.query(`INSERT INTO alert_history (alert_id, state, at, by) VALUES ($1,'Active',$2,'Swathdeck')`, [id, actorTime]);
  await emailOutbox.queueAlert(c, id, kind, vessel.name, missionId, position, actorTime);
  await recordEvent(c, missionId, 'alert', 'Swathdeck', `${heading} Active`);
  return id;
}

export async function clearAlert(c: pg.PoolClient, alertId: string, actorName: string, actorTime: Date): Promise<void> {
  const r = await c.query(`SELECT state, mission_id, heading FROM alerts WHERE id = $1 FOR UPDATE`, [alertId]);
  if (r.rows.length === 0) return;
  const a = r.rows[0]!;
  if (a.state === 'Active') {
    await c.query(`UPDATE alerts SET state = 'Rectified', rectified_at = $2 WHERE id = $1`, [alertId, actorTime]);
    await c.query(`INSERT INTO alert_history (alert_id, state, at, by) VALUES ($1,'Rectified',$2,$3)`, [alertId, actorTime, actorName]);
    await recordEvent(c, a.mission_id, 'alert', actorName, `${a.heading} Rectified`);
  } else if (a.state === 'Acknowledged') {
    await c.query(`UPDATE alerts SET state = 'Closed', rectified_at = $2 WHERE id = $1`, [alertId, actorTime]);
    await c.query(`INSERT INTO alert_history (alert_id, state, at, by) VALUES ($1,'Closed',$2,$3)`, [alertId, actorTime, actorName]);
    await recordEvent(c, a.mission_id, 'alert', actorName, `${a.heading} Closed`);
  }
}

// ---------------- coverage recompute ----------------

interface MissionInfo {
  id: string; status: string; survey_area: Position[]; geofence: Position[];
  planned_depth_m: number; swath_ratio: number; overlap_pct: number;
  line_azimuth_deg: number; planned_speed_mps: number; survey_order: SurveyOrder;
  hold: unknown;
}

async function missionInfo(c: pg.PoolClient, missionId: string): Promise<MissionInfo | null> {
  const r = await c.query(`SELECT * FROM missions WHERE id = $1`, [missionId]);
  if (r.rows.length === 0) return null;
  const m = r.rows[0]!;
  return {
    id: m.id, status: m.status,
    survey_area: m.survey_area as Position[], geofence: m.geofence as Position[],
    planned_depth_m: m.planned_depth_m, swath_ratio: m.swath_ratio,
    overlap_pct: m.overlap_pct, line_azimuth_deg: m.line_azimuth_deg,
    planned_speed_mps: m.planned_speed_mps, survey_order: m.survey_order as SurveyOrder,
    hold: m.hold,
  };
}

interface LineInfo {
  id: string; label: string; kind: 'planned' | 'crossline' | 'infill'; status: string;
  vessel_id: string | null; start: Position; end: Position; length_m: number;
  holiday_id: string | null; rerun_of: string | null;
}

async function missionLines(c: pg.PoolClient, missionId: string): Promise<LineInfo[]> {
  const r = await c.query(`SELECT * FROM lines WHERE mission_id = $1 ORDER BY seq, id`, [missionId]);
  return r.rows.map(l => ({
    id: l.id, label: l.label, kind: l.kind, status: l.status,
    vessel_id: l.vessel_id, start: l.start as Position, end: l.end as Position,
    length_m: l.length_m, holiday_id: l.holiday_id, rerun_of: l.rerun_of,
  }));
}

// A line that currently counts in overlap/coverage/holidays.
// Superseded lines count in nothing. A re-run counts only once Delivered.
function lineCountsInCoverage(l: LineInfo): boolean {
  if (l.status === 'Superseded') return false;
  if (l.rerun_of) return l.status === 'Delivered';
  return true;
}

function lineDirectionDeg(l: LineInfo, azimuth: number): number {
  if (l.kind === 'crossline') return azimuth + 90;
  return azimuth;
}

export interface HolidayUpdate {
  id: string; label: string; status: 'Open' | 'Queued' | 'Closed';
  area_m2: number; cell_count: number; centroid: Position;
  cells: { col: number; row: number }[]; infill_line_id: string | null;
}

export interface CoverageResult {
  counters: { coverage_pct: number; open_holidays: number; lines_remaining: number };
  crosslineAgreement: { compared: number; within: number; pct: number | null; meets_order: boolean | null };
  holidayUpdates: HolidayUpdate[];
}

export async function recomputeCoverage(c: pg.PoolClient, missionId: string): Promise<CoverageResult> {
  const m = await missionInfo(c, missionId);
  if (!m) throw apiError(404, 'not_found', 'That record does not exist');
  const lines = await missionLines(c, missionId);
  const spec = gridSpec(m.survey_area);
  const cols = spec.cols;
  const inArea = areaCells(m.survey_area, spec.origin, spec.cols, spec.rows);

  const fixesByLine = new Map<string, FixRow[]>();
  const runningFixes = await c.query(
    `SELECT f.* FROM fixes f JOIN lines l ON l.id = f.line_id WHERE l.mission_id = $1 ORDER BY f.t ASC`, [missionId]);
  for (const row of runningFixes.rows) {
    const f = rowToFix(row);
    const arr = fixesByLine.get(f.line_id!) ?? [];
    arr.push(f);
    fixesByLine.set(f.line_id!, arr);
  }

  const cellLines = new Map<number, Set<string>>();
  const cellDepths = new Map<string, { sum: number; count: number }>();
  const coveredSegments = new Map<string, number>();

  for (const line of lines) {
    if (!lineCountsInCoverage(line)) continue;
    const lineFixes = fixesByLine.get(line.id) ?? [];
    const dirDeg = lineDirectionDeg(line, m.line_azimuth_deg);
    let sweptLen = 0;
    for (let i = 1; i < lineFixes.length; i++) {
      const a = lineFixes[i - 1]!;
      const b = lineFixes[i]!;
      if (!sweepsSwath(a, b, m.planned_speed_mps, dirDeg)) continue;
      sweptLen += Math.hypot(b.easting - a.easting, b.northing - a.northing);
      const cells = swathCells(a, b, b.depth_m, m.swath_ratio, spec.origin, cols, spec.rows);
      for (const cellIdx of cells) {
        if (!inArea.has(cellIdx)) continue;
        let set = cellLines.get(cellIdx);
        if (!set) { set = new Set(); cellLines.set(cellIdx, set); }
        set.add(line.id);
        const dk = `${cellIdx}|${line.id}`;
        const d = cellDepths.get(dk) ?? { sum: 0, count: 0 };
        d.sum += b.depth_m; d.count += 1;
        cellDepths.set(dk, d);
      }
    }
    coveredSegments.set(line.id, sweptLen);
  }

  await c.query(`DELETE FROM coverage_cells WHERE mission_id = $1`, [missionId]);
  await c.query(`DELETE FROM cell_line_depth WHERE mission_id = $1`, [missionId]);
  const cellCols: number[] = [];
  const cellRows: number[] = [];
  const cellLinesArr: string[] = [];
  for (const [cellIdx, set] of cellLines) {
    cellCols.push(cellIdx % cols);
    cellRows.push(Math.floor(cellIdx / cols));
    cellLinesArr.push(JSON.stringify([...set]));
  }
  if (cellCols.length > 0) {
    await c.query(
      `INSERT INTO coverage_cells (mission_id, col, row, lines)
       SELECT $1, x, y, j::jsonb FROM unnest($2::int[], $3::int[], $4::text[]) AS t(x, y, j)`,
      [missionId, cellCols, cellRows, cellLinesArr]);
  }
  const depCols: number[] = [];
  const depRows: number[] = [];
  const depLines: string[] = [];
  const depSums: number[] = [];
  const depCounts: number[] = [];
  for (const [dk, d] of cellDepths) {
    const [cellIdxStr, lineId] = dk.split('|');
    const cellIdx = Number(cellIdxStr);
    depCols.push(cellIdx % cols);
    depRows.push(Math.floor(cellIdx / cols));
    depLines.push(lineId!);
    depSums.push(d.sum);
    depCounts.push(d.count);
  }
  if (depCols.length > 0) {
    await c.query(
      `INSERT INTO cell_line_depth (mission_id, col, row, line_id, depth_sum, pair_count)
       SELECT $1, x, y, l, s, n FROM unnest($2::int[], $3::int[], $4::text[], $5::double precision[], $6::int[]) AS t(x, y, l, s, n)`,
      [missionId, depCols, depRows, depLines, depSums, depCounts]);
  }

  if (lines.length > 0) {
    const lineIds2: string[] = lines.map(l => l.id);
    const lineCovers: number[] = lines.map(l => coveredSegments.get(l.id) ?? 0);
    await c.query(
      `UPDATE lines l SET covered_m = t.cov FROM unnest($1::text[], $2::double precision[]) AS t(id, cov)
       WHERE l.id = t.id`,
      [lineIds2, lineCovers]);
  }

  let compared = 0, within = 0;
  const crosslines = lines.filter(l => l.kind === 'crossline' && lineCountsInCoverage(l));
  const mains = lines.filter(l => l.kind === 'planned' && lineCountsInCoverage(l));
  const depthAt = (cellIdx: number, lineId: string): number | null => {
    const d = cellDepths.get(`${cellIdx}|${lineId}`);
    return d ? d.sum / d.count : null;
  };
  for (const cellIdx of inArea) {
    for (const x of crosslines) {
      const dX = depthAt(cellIdx, x.id);
      if (dX === null) continue;
      for (const l of mains) {
        const dL = depthAt(cellIdx, l.id);
        if (dL === null) continue;
        compared += 1;
        if (withinUncertainty(dX, dL, m.survey_order)) within += 1;
      }
    }
  }

  const holidayUpdates = await recomputeHolidays(c, missionId, m, lines, inArea, spec, cellLines);

  const coveredCells = [...inArea].filter(idx => cellLines.has(idx)).length;
  const coverage_pct = roundHalfUp(coveredCells / inArea.size * 100, 1);
  const openHolidays = holidayUpdates.filter(h => h.status === 'Open').length;
  const linesRemaining = lines.filter(l => ['Pending', 'Assigned', 'Running'].includes(l.status)).length;

  await c.query(
    `INSERT INTO mission_counters (mission_id, coverage_pct, open_holidays, lines_remaining, compared, within)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (mission_id) DO UPDATE SET coverage_pct = EXCLUDED.coverage_pct,
       open_holidays = EXCLUDED.open_holidays, lines_remaining = EXCLUDED.lines_remaining,
       compared = EXCLUDED.compared, within = EXCLUDED.within`,
    [missionId, coverage_pct, openHolidays, linesRemaining, compared, within]);

  return {
    counters: { coverage_pct, open_holidays: openHolidays, lines_remaining: linesRemaining },
    crosslineAgreement: compared === 0
      ? { compared, within, pct: null, meets_order: null }
      : (() => { const pct = roundHalfUp(within / compared * 100, 1); return { compared, within, pct, meets_order: pct >= 95.0 }; })(),
    holidayUpdates,
  };
}

function lowestCell(g: { col: number; row: number }[]): { col: number; row: number } {
  let low = g[0]!;
  for (const cc of g) if (cc.row < low.row || (cc.row === low.row && cc.col < low.col)) low = cc;
  return low;
}

function computeHolidayGroups(
  m: MissionInfo, lines: LineInfo[], inArea: Set<number>,
  spec: { origin: Position; cols: number; rows: number }, cellLines: Map<number, Set<string>>,
): { col: number; row: number }[][] {
  const azimuth = m.line_azimuth_deg;
  const a = azimuth * Math.PI / 180;
  const across = { x: Math.cos(a), y: -Math.sin(a) };
  const byId = new Map(lines.map(l => [l.id, l]));
  const stripLines: { lineId: string; offset: number }[] = [];
  for (const l of lines) {
    if (l.kind !== 'planned' || !lineCountsInCoverage(l)) continue;
    const mid: Position = { easting: (l.start.easting + l.end.easting) / 2, northing: (l.start.northing + l.end.northing) / 2 };
    stripLines.push({ lineId: l.id, offset: mid.easting * across.x + mid.northing * across.y });
  }
  stripLines.sort((p, q) => p.offset - q.offset);

  const holidayCells: { col: number; row: number }[] = [];
  if (stripLines.length > 0) {
    for (const cellIdx of inArea) {
      if (cellLines.has(cellIdx)) continue;
      const r = Math.floor(cellIdx / spec.cols);
      const col = cellIdx % spec.cols;
      const centre = cellCentre(spec.origin, col, r);
      const off = centre.easting * across.x + centre.northing * across.y;
      let ownerId: string | undefined;
      if (off <= stripLines[0]!.offset) {
        ownerId = stripLines[0]!.lineId; // first strip runs to the area's low edge
      } else {
        for (let i = 0; i < stripLines.length - 1; i++) {
          const lo = stripLines[i]!, hi = stripLines[i + 1]!;
          if (off > lo.offset && off <= hi.offset) {
            const boundary = (lo.offset + hi.offset) / 2;
            ownerId = off <= boundary ? lo.lineId : hi.lineId;
            break;
          }
        }
        if (!ownerId && off > stripLines[stripLines.length - 1]!.offset) {
          ownerId = stripLines[stripLines.length - 1]!.lineId; // last strip runs to the high edge
        }
      }
      const owner = ownerId ? byId.get(ownerId) : undefined;
      if (owner && (owner.status === 'Surveyed' || owner.status === 'Delivered')) {
        holidayCells.push({ col, row: r });
      }
    }
  }

  const key = (col: number, row: number) => col * 100000 + row;
  const hset = new Set(holidayCells.map(cc => key(cc.col, cc.row)));
  const groups: { col: number; row: number }[][] = [];
  const visited = new Set<number>();
  for (const cell of holidayCells) {
    const k = key(cell.col, cell.row);
    if (visited.has(k)) continue;
    const group: { col: number; row: number }[] = [];
    const stack = [cell];
    visited.add(k);
    while (stack.length) {
      const cur = stack.pop()!;
      group.push(cur);
      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nk = key(cur.col + dc, cur.row + dr);
        if (hset.has(nk) && !visited.has(nk)) {
          visited.add(nk);
          stack.push({ col: cur.col + dc, row: cur.row + dr });
        }
      }
    }
    groups.push(group);
  }
  return groups.filter(g => holidayQualifies(g));
}

async function recomputeHolidays(
  c: pg.PoolClient, missionId: string, m: MissionInfo, lines: LineInfo[],
  inArea: Set<number>, spec: { origin: Position; cols: number; rows: number }, cellLines: Map<number, Set<string>>,
): Promise<HolidayUpdate[]> {
  const groups = computeHolidayGroups(m, lines, inArea, spec, cellLines);
  groups.sort((g1, g2) => {
    const l1 = lowestCell(g1), l2 = lowestCell(g2);
    return l1.row - l2.row || l1.col - l2.col;
  });
  const byId = new Map(lines.map(l => [l.id, l]));

  const existingRows = (await c.query(`SELECT * FROM holidays WHERE mission_id = $1`, [missionId])).rows;
  const prevCells = new Map<string, { col: number; row: number }[]>();
  const snap = await c.query(`SELECT holiday_id, col, row FROM holiday_cells WHERE mission_id = $1`, [missionId]);
  for (const row of snap.rows) {
    const arr = prevCells.get(row.holiday_id as string) ?? [];
    arr.push({ col: row.col as number, row: row.row as number });
    prevCells.set(row.holiday_id as string, arr);
  }

  const openQueued = existingRows
    .filter((h: Record<string, unknown>) => h.status === 'Open' || h.status === 'Queued')
    .map((h: Record<string, unknown>) => ({
      id: h.id as string, label: h.label as string, status: h.status as string,
      infill_line_id: h.infill_line_id as string | null,
    }));

  const ck = (cc: { col: number; row: number }) => `${cc.col},${cc.row}`;
  // Best match per group: shares the most cells with an Open/Queued holiday; ties to the lowest label number.
  const groupMatch: (string | null)[] = groups.map(group => {
    let best: { id: string; shared: number; labelNum: number } | null = null;
    for (const h of openQueued) {
      const hset = new Set((prevCells.get(h.id) ?? []).map(ck));
      let shared = 0;
      for (const g of group) if (hset.has(ck(g))) shared++;
      if (shared === 0) continue;
      const labelNum = Number(h.label.slice(1));
      if (!best || shared > best.shared || (shared === best.shared && labelNum < best.labelNum)) {
        best = { id: h.id, shared, labelNum };
      }
    }
    return best?.id ?? null;
  });

  // When several groups share a best match, the winner shares more cells with it, then more cells, then the lowest cell.
  const claimed = new Map<string, { col: number; row: number }[]>();
  for (let gi = 0; gi < groups.length; gi++) {
    const exId = groupMatch[gi];
    const group = groups[gi]!;
    if (!exId) continue;
    const cur = claimed.get(exId);
    if (!cur) { claimed.set(exId, group); continue; }
    const hset = new Set((prevCells.get(exId) ?? []).map(ck));
    const score = (g: { col: number; row: number }[]) => g.filter(cc => hset.has(ck(cc))).length;
    if (score(group) > score(cur) ||
      (score(group) === score(cur) && group.length > cur.length)) {
      claimed.set(exId, group);
    }
  }

  const winnerSet = new Set(claimed.values() as IterableIterator<{ col: number; row: number }[]>);
  const unmatchedGroups = groups.filter(g => !winnerSet.has(g));

  let labelNum = existingRows.reduce((mx: number, r: Record<string, unknown>) => Math.max(mx, Number((r.label as string).slice(1))), 0);

  await c.query(`DELETE FROM holiday_cells WHERE mission_id = $1`, [missionId]);
  const result: HolidayUpdate[] = [];

  const persist = async (group: { col: number; row: number }[], id: string, label: string,
    status: 'Open' | 'Queued', infillLineId: string | null) => {
    const area = group.length * 25;
    const cx = group.reduce((s, cc) => s + spec.origin.easting + cc.col * CELL_SIZE + 2.5, 0) / group.length;
    const cy = group.reduce((s, cc) => s + spec.origin.northing + cc.row * CELL_SIZE + 2.5, 0) / group.length;
    await c.query(
      `INSERT INTO holidays (id, mission_id, label, status, area_m2, cell_count, centroid, infill_line_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status,
        area_m2 = EXCLUDED.area_m2, cell_count = EXCLUDED.cell_count, centroid = EXCLUDED.centroid,
        infill_line_id = EXCLUDED.infill_line_id`,
      [id, missionId, label, status, area, group.length, jpos({ easting: cx, northing: cy }), infillLineId]
    );
    for (const cc of group) {
      await c.query(`INSERT INTO holiday_cells (mission_id, holiday_id, col, row) VALUES ($1,$2,$3,$4)`,
        [missionId, id, cc.col, cc.row]);
    }
    result.push({
      id, label, status, area_m2: area, cell_count: group.length,
      centroid: { easting: cx, northing: cy }, cells: group, infill_line_id: infillLineId,
    });
  };

  for (const [exId, group] of claimed) {
    const ex = openQueued.find(h => h.id === exId)!;
    let status: 'Open' | 'Queued' = 'Open';
    if (ex.infill_line_id) {
      const inf = byId.get(ex.infill_line_id);
      status = inf && (inf.status === 'Assigned' || inf.status === 'Running') ? 'Queued' : 'Open';
    }
    await persist(group, exId, ex.label, status, ex.infill_line_id);
  }
  for (const group of unmatchedGroups) {
    labelNum += 1;
    await persist(group, newId('hol'), `H${labelNum}`, 'Open', null);
  }
  for (const h of openQueued) {
    if (!claimed.has(h.id)) {
      await c.query(`UPDATE holidays SET status = 'Closed' WHERE id = $1`, [h.id]);
      await c.query(`DELETE FROM holiday_cells WHERE holiday_id = $1`, [h.id]);
      result.push({
        id: h.id, label: h.label, status: 'Closed', area_m2: 0, cell_count: 0,
        centroid: { easting: 0, northing: 0 }, cells: [], infill_line_id: h.infill_line_id,
      });
    }
  }
  return result;
}
