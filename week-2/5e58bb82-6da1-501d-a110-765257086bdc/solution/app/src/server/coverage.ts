// Coverage: the 5 m grid, swath cells, overlap, holidays and specks, crossline agreement and the counters.
// Each of these rules is decided here and nowhere else.
import type { Db } from "./db.js";
import { one, only, rows } from "./db.js";
import { directions, dot, insideConvex, vec, type Position, type Vec } from "./geometry.js";
import { counts, loadLines } from "./lines.js";
import { roundHalf } from "./numbers.js";
import { newId } from "./passwords.js";
import type { Cell, HolidayRecord, LineRecord, MissionCoverageRecord, MissionRecord, SweepRecord } from "./records.js";

export const CELL = 5;
const RUN_MIN = 3;
const ORDER_COEFFICIENTS: Record<string, [number, number]> = { special: [0.25, 0.0075], "1a": [0.5, 0.013] };

interface Grid {
  origin: Position;
  cols: number;
  rows: number;
  /** -1 outside the area, else the number of counting lines whose swaths contain the cell centre. */
  overlap: number[];
  inArea: boolean[];
}

type Sweep = Pick<SweepRecord, "line_id" | "ax" | "ay" | "bx" | "by_" | "half_width" | "depth_m">;

/** The swath rule's exclusions: a pair sweeps only when all of these hold. */
export function pairSweeps(dtSeconds: number, speed: number, plannedSpeed: number, headingDeg: number, lineDirectionDeg: number): boolean {
  const delta = (((headingDeg - lineDirectionDeg) % 180) + 180) % 180;
  return dtSeconds > 0 && dtSeconds <= 60 && speed <= 1.5 * plannedSpeed && Math.min(delta, 180 - delta) <= 20;
}

/** A line's direction for the heading rule: the azimuth, or azimuth + 90° for a crossline. */
export const lineDirection = (kind: string, azimuth: number) => azimuth + (kind === "crossline" ? 90 : 0);

export function gridOf(area: Position[]): Omit<Grid, "overlap"> {
  const es = area.map((p) => p.easting);
  const ns = area.map((p) => p.northing);
  const ox = CELL * Math.floor(Math.min(...es) / CELL);
  const oy = CELL * Math.floor(Math.min(...ns) / CELL);
  const cols = Math.round((CELL * Math.ceil(Math.max(...es) / CELL) - ox) / CELL);
  const rowsCount = Math.round((CELL * Math.ceil(Math.max(...ns) / CELL) - oy) / CELL);
  const points = area.map(vec);
  const inArea: boolean[] = new Array(cols * rowsCount);
  for (let r = 0; r < rowsCount; r++) {
    for (let c = 0; c < cols; c++) inArea[r * cols + c] = insideConvex(points, [ox + CELL * c + 2.5, oy + CELL * r + 2.5], 1e-9);
  }
  return { origin: { easting: ox, northing: oy }, cols, rows: rowsCount, inArea };
}

/** Cells whose centres fall in a sweep's rectangle. */
function sweepCells(g: Omit<Grid, "overlap">, s: Sweep, visit: (index: number) => void): void {
  const seg = Math.hypot(s.bx - s.ax, s.by_ - s.ay);
  if (seg === 0) return;
  const ux = (s.bx - s.ax) / seg;
  const uy = (s.by_ - s.ay) / seg;
  const hw = s.half_width;
  const { easting: ox, northing: oy } = g.origin;
  const c0 = Math.max(0, Math.floor((Math.min(s.ax, s.bx) - hw - ox) / CELL) - 1);
  const c1 = Math.min(g.cols - 1, Math.ceil((Math.max(s.ax, s.bx) + hw - ox) / CELL) + 1);
  const r0 = Math.max(0, Math.floor((Math.min(s.ay, s.by_) - hw - oy) / CELL) - 1);
  const r1 = Math.min(g.rows - 1, Math.ceil((Math.max(s.ay, s.by_) + hw - oy) / CELL) + 1);
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      const cx = ox + CELL * c + 2.5;
      const cy = oy + CELL * r + 2.5;
      const along = (cx - s.ax) * ux + (cy - s.ay) * uy;
      const off = Math.abs((cy - s.ay) * ux - (cx - s.ax) * uy);
      if (along >= 0 && along <= seg && off <= hw) visit(r * g.cols + c);
    }
  }
}

interface CoverageResult {
  grid: Grid;
  coveragePct: number;
  compared: number;
  within: number;
  /** Qualifying holiday groups (cell indexes), never specks. */
  groups: number[][];
}

/** Everything coverage decides, from a mission, its lines and its stored sweeps. */
export function computeCoverage(mission: MissionRecord, lines: LineRecord[], sweeps: Sweep[]): CoverageResult {
  const area: Position[] = mission.survey_area;
  const base = gridOf(area);
  const counting = new Map(lines.filter((l) => counts(l)).map((l) => [l.id, l]));
  const cellsByLine = new Map<string, Set<number>>();
  const depthByLine = new Map<string, Map<number, [number, number]>>();
  for (const s of sweeps) {
    if (!counting.has(s.line_id)) continue;
    const cells = cellsByLine.get(s.line_id) ?? new Set<number>();
    cellsByLine.set(s.line_id, cells);
    const depths = depthByLine.get(s.line_id) ?? new Map<number, [number, number]>();
    depthByLine.set(s.line_id, depths);
    sweepCells(base, s, (i) => {
      cells.add(i);
      if (!base.inArea[i]) return;
      const d = depths.get(i) ?? [0, 0];
      d[0] += s.depth_m;
      d[1] += 1;
      depths.set(i, d);
    });
  }
  const overlap = base.inArea.map((inside) => (inside ? 0 : -1));
  for (const cells of cellsByLine.values()) for (const i of cells) if (overlap[i] >= 0) overlap[i] += 1;
  const areaCells = base.inArea.filter(Boolean).length;
  const covered = overlap.filter((v) => v > 0).length;
  const coveragePct = areaCells ? roundHalf((covered / areaCells) * 100, 1) : 0;

  const [a, b] = ORDER_COEFFICIENTS[mission.survey_order];
  const crosslines = [...counting.values()].filter((l) => l.kind === "crossline").map((l) => depthByLine.get(l.id)).filter((d) => d !== undefined);
  const mainscheme = [...counting.values()].filter((l) => l.kind === "planned").map((l) => depthByLine.get(l.id)).filter((d) => d !== undefined);
  let compared = 0;
  let within = 0;
  for (const x of crosslines) {
    for (const [cell, [sumX, nX]] of x) {
      const dX = sumX / nX;
      for (const m of mainscheme) {
        const hit = m.get(cell);
        if (!hit) continue;
        const dL = hit[0] / hit[1];
        compared += 1;
        if (Math.abs(dX - dL) <= Math.sqrt(a ** 2 + (b * (dX + dL) / 2) ** 2)) within += 1;
      }
    }
  }

  const grid: Grid = { ...base, overlap };
  return { grid, coveragePct, compared, within, groups: holidayGroups(grid, mission, [...counting.values()]) };
}

/** Holiday cells: uncovered area cells whose strip owner is Surveyed or Delivered; groups with a 3-cell run. */
function holidayGroups(g: Grid, mission: MissionRecord, counting: LineRecord[]): number[][] {
  const owners = counting.flatMap((l) => (l.kind === "planned" && l.offset_m !== null ? [{ ...l, offset_m: l.offset_m }] : []))
    .sort((x, y) => x.offset_m - y.offset_m);
  if (!owners.length) return [];
  const bounds = owners.slice(1).map((l, i) => (owners[i].offset_m + l.offset_m) / 2);
  const { across } = directions(mission.line_azimuth_deg);
  const p0 = Math.min(...(mission.survey_area as Position[]).map((p) => dot(vec(p), across)));
  const holiday = new Set<number>();
  for (let r = 0; r < g.rows; r++) {
    for (let c = 0; c < g.cols; c++) {
      const i = r * g.cols + c;
      if (g.overlap[i] !== 0) continue;
      const centre: Vec = [g.origin.easting + CELL * c + 2.5, g.origin.northing + CELL * r + 2.5];
      const offset = dot(centre, across) - p0;
      const owner = owners[bounds.filter((bound) => offset >= bound).length];
      if (owner.status === "Surveyed" || owner.status === "Delivered") holiday.add(i);
    }
  }
  const seen = new Set<number>();
  const groups: number[][] = [];
  for (const start of [...holiday].sort((x, y) => x - y)) {
    if (seen.has(start)) continue;
    const group: number[] = [];
    const stack = [start];
    seen.add(start);
    for (let i = stack.pop(); i !== undefined; i = stack.pop()) {
      group.push(i);
      const c = i % g.cols;
      const neighbours = [c + 1 < g.cols ? i + 1 : -1, c > 0 ? i - 1 : -1, i + g.cols, i - g.cols];
      for (const n of neighbours) {
        if (n >= 0 && n < g.cols * g.rows && holiday.has(n) && !seen.has(n)) {
          seen.add(n);
          stack.push(n);
        }
      }
    }
    const members = new Set(group);
    const run = group.some((i) => {
      const c = i % g.cols;
      const horizontal = c + RUN_MIN - 1 < g.cols && [1, 2].every((k) => members.has(i + k));
      const vertical = [1, 2].every((k) => members.has(i + k * g.cols));
      return horizontal || vertical;
    });
    if (run) groups.push(group.sort((x, y) => x - y));
  }
  return groups;
}

/** Cell centres of a holiday, and their centroid. */
export function centroidOf(g: Pick<Grid, "origin" | "cols">, cells: [number, number][]): Position {
  const e = cells.reduce((sum, [c]) => sum + g.origin.easting + CELL * c + 2.5, 0) / cells.length;
  const n = cells.reduce((sum, [, r]) => sum + g.origin.northing + CELL * r + 2.5, 0) / cells.length;
  return { easting: e, northing: n };
}

export async function loadSweeps(db: Db, missionId: string): Promise<Sweep[]> {
  return rows<Sweep>(db, "SELECT line_id, ax, ay, bx, by_, half_width, depth_m FROM sweeps WHERE mission_id = $1 ORDER BY id", [missionId]);
}

/**
 * Recomputes coverage, agreement and holiday labels after a change, in the caller's transaction.
 * The coverage row lock serialises refreshes of one mission.
 */
export async function refreshCoverage(db: Db, missionId: string): Promise<void> {
  await db.query("SELECT 1 FROM mission_coverage WHERE mission_id = $1 FOR UPDATE", [missionId]);
  const mission = await only<MissionRecord>(db, "SELECT * FROM missions WHERE id = $1", [missionId]);
  const lines = await loadLines(db, missionId);
  const result = computeCoverage(mission, lines, await loadSweeps(db, missionId));
  await db.query("UPDATE mission_coverage SET coverage_pct = $2, compared = $3, within = $4 WHERE mission_id = $1",
    [missionId, result.coveragePct, result.compared, result.within]);
  await relabel(db, mission, lines, result);
}

async function relabel(db: Db, mission: MissionRecord, lines: LineRecord[], result: CoverageResult): Promise<void> {
  const { cols } = result.grid;
  const toCell = (i: number): Cell => [i % cols, Math.floor(i / cols)];
  const groups = result.groups.map((g) => g.map(toCell));
  const existing = await rows<HolidayRecord>(db, "SELECT * FROM holidays WHERE mission_id = $1 AND status <> 'Closed' ORDER BY label_no", [mission.id]);
  const keyOf = ([c, r]: Cell) => `${c},${r}`;
  const sets = existing.map((h) => new Set(h.cells.map(keyOf)));
  const shared = (g: Cell[], k: number) => g.reduce((n, cell) => n + (sets[k].has(keyOf(cell)) ? 1 : 0), 0);
  const lowest = (g: Cell[]) => g.reduce((best, cell) => (cell[1] < best[1] || (cell[1] === best[1] && cell[0] < best[0]) ? cell : best));

  const best = groups.map((g) => {
    let pick = -1;
    let most = 0;
    existing.forEach((_, k) => {
      const n = shared(g, k);
      if (n > most) {
        most = n;
        pick = k;
      }
    });
    return { pick, most };
  });
  const winner = new Map<number, number>();
  existing.forEach((_, k) => {
    const candidates = groups.map((g, gi) => ({ g, gi })).filter(({ gi }) => best[gi].pick === k);
    if (!candidates.length) return;
    candidates.sort((x, y) => {
      const dShared = best[y.gi].most - best[x.gi].most;
      if (dShared) return dShared;
      const dSize = y.g.length - x.g.length;
      if (dSize) return dSize;
      const lx = lowest(x.g);
      const ly = lowest(y.g);
      return lx[1] - ly[1] || lx[0] - ly[0];
    });
    winner.set(candidates[0].gi, k);
  });

  const lineStatus = new Map(lines.map((l) => [l.id, l.status]));
  const statusFor = (infillLineId: string | null) =>
    infillLineId && ["Assigned", "Running"].includes(lineStatus.get(infillLineId) ?? "") ? "Queued" : "Open";

  const matched = new Set<number>();
  for (const [gi, k] of winner) {
    matched.add(k);
    const h = existing[k];
    await db.query("UPDATE holidays SET cells = $2, status = $3 WHERE id = $1",
      [h.id, JSON.stringify(groups[gi]), statusFor(h.infill_line_id)]);
  }
  for (const [k, h] of existing.entries()) {
    if (!matched.has(k)) await db.query("UPDATE holidays SET status = 'Closed' WHERE id = $1", [h.id]);
  }
  const fresh = groups.map((g, gi) => ({ g, gi })).filter(({ gi }) => !winner.has(gi))
    .sort((x, y) => {
      const lx = lowest(x.g);
      const ly = lowest(y.g);
      return lx[1] - ly[1] || lx[0] - ly[0];
    });
  if (!fresh.length) return;
  let next = ((await one<{ n: number | null }>(db, "SELECT max(label_no) AS n FROM holidays WHERE mission_id = $1", [mission.id]))?.n ?? 0) + 1;
  for (const { g } of fresh) {
    await db.query("INSERT INTO holidays (id, mission_id, label_no, status, cells) VALUES ($1,$2,$3,'Open',$4)",
      [newId("h"), mission.id, next, JSON.stringify(g)]);
    next += 1;
  }
}

/** The three mission counters, read from the one stored decision and the line and holiday records. */
export async function counters(db: Db, missionId: string): Promise<{ coverage_pct: number; open_holidays: number; lines_remaining: number }> {
  const row = await only<{ coverage_pct: number; open_holidays: number; lines_remaining: number }>(db,
    `SELECT c.coverage_pct,
       (SELECT count(*) FROM holidays h WHERE h.mission_id = $1 AND h.status = 'Open') AS open_holidays,
       (SELECT count(*) FROM lines l WHERE l.mission_id = $1 AND l.status IN ('Pending','Assigned','Running')) AS lines_remaining
     FROM mission_coverage c WHERE c.mission_id = $1`, [missionId]);
  return { coverage_pct: row.coverage_pct, open_holidays: row.open_holidays, lines_remaining: row.lines_remaining };
}

export async function agreement(db: Db, missionId: string): Promise<{ compared: number; within: number; pct: number | null; meets_order: boolean | null }> {
  const row = await only<Pick<MissionCoverageRecord, "compared" | "within">>(db, "SELECT compared, within FROM mission_coverage WHERE mission_id = $1", [missionId]);
  if (!row.compared) return { compared: 0, within: 0, pct: null, meets_order: null };
  const pct = roundHalf((row.within / row.compared) * 100, 1);
  return { compared: row.compared, within: row.within, pct, meets_order: pct >= 95.0 };
}

export function holidayJson(h: HolidayRecord, g: Pick<Grid, "origin" | "cols">, nearest: { id: string; name: string } | null): Record<string, unknown> {
  const cells = h.cells.slice().sort((x, y) => x[1] - y[1] || x[0] - y[0]);
  return {
    id: h.id,
    label: `H${h.label_no}`,
    status: h.status,
    area_m2: cells.length * CELL * CELL,
    cell_count: cells.length,
    centroid: centroidOf(g, cells),
    cells,
    nearest_vessel: nearest,
    infill_line_id: h.infill_line_id ?? null,
  };
}
