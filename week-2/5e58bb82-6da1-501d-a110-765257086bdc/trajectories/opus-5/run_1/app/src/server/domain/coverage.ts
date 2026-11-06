import { roundHalfUp } from '../../shared/numbers.js';
import type { CrosslineAgreement, LineKind, LineStatus, Position } from '../../shared/types.js';
import {
  containsPoint,
  directions,
  headingDeviation,
  project,
  spread,
  type Vec,
} from './geometry.js';
import { lineDirectionDeg } from './plan.js';

export const CELL_SIZE_M = 5;
export const MAX_FIX_GAP_S = 60;
export const SWEEP_SPEED_FACTOR = 1.5;
export const SWEEP_HEADING_TOLERANCE_DEG = 20;
export const MIN_RUNNING_SPEED_MPS = 0.3;
export const HOLIDAY_MIN_RUN = 3;

/** Survey-order coefficients for the allowed vertical uncertainty. */
const ORDER_COEFFICIENTS = {
  special: { a: 0.25, b: 0.0075 },
  '1a': { a: 0.5, b: 0.013 },
};

export interface MissionGeometry {
  survey_area: Position[];
  geofence: Position[];
  line_azimuth_deg: number;
  swath_ratio: number;
  planned_speed_mps: number;
  survey_order: 'special' | '1a';
}

export interface CoverageLine {
  id: string;
  kind: LineKind;
  status: LineStatus;
  rerun_of: string | null;
  start: Position;
  end: Position;
  length_m: number;
}

export interface CoverageFix {
  vessel_id: string;
  line_id: string | null;
  t: number;
  easting: number;
  northing: number;
  heading_deg: number;
  speed_mps: number;
  depth_m: number;
}

export interface Grid {
  origin: Position;
  cols: number;
  rows: number;
  /** -1 outside the survey area, otherwise the number of distinct lines covering it. */
  overlap: number[][];
  inArea: boolean[];
  areaCellCount: number;
}

export interface Sweep {
  lineId: string;
  from: CoverageFix;
  to: CoverageFix;
  length: number;
}

export interface CoverageResult {
  grid: Grid;
  coveragePct: number;
  coveredByLine: Map<string, number>;
  /** Mean swept depth per line, keyed by cell index. */
  depthByLine: Map<string, Map<number, number>>;
  sweeps: Sweep[];
  crosslineAgreement: CrosslineAgreement;
}

function floorToCell(value: number): number {
  return Math.floor(value / CELL_SIZE_M) * CELL_SIZE_M;
}

function ceilToCell(value: number): number {
  return Math.ceil(value / CELL_SIZE_M) * CELL_SIZE_M;
}

/** The mission's 5 m coverage grid, with its cells inside the survey area marked. */
export function buildGrid(area: Position[]): Grid {
  const eastings = area.map((p) => p.easting);
  const northings = area.map((p) => p.northing);
  const origin: Position = {
    easting: floorToCell(Math.min(...eastings)),
    northing: floorToCell(Math.min(...northings)),
  };
  const cols = Math.max(1, (ceilToCell(Math.max(...eastings)) - origin.easting) / CELL_SIZE_M);
  const rows = Math.max(1, (ceilToCell(Math.max(...northings)) - origin.northing) / CELL_SIZE_M);
  const inArea = new Array<boolean>(cols * rows).fill(false);
  let areaCellCount = 0;
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const centre = cellCentre(origin, c, r);
      if (containsPoint(area, centre)) {
        inArea[r * cols + c] = true;
        areaCellCount += 1;
      }
    }
  }
  const overlap = Array.from({ length: rows }, (_unused, r) =>
    Array.from({ length: cols }, (_also, c) => (inArea[r * cols + c] ? 0 : -1)),
  );
  return { origin, cols, rows, overlap, inArea, areaCellCount };
}

export function cellCentre(origin: Position, col: number, row: number): Position {
  return {
    easting: origin.easting + CELL_SIZE_M * col + CELL_SIZE_M / 2,
    northing: origin.northing + CELL_SIZE_M * row + CELL_SIZE_M / 2,
  };
}

/**
 * A line counts in overlap, coverage, holidays and crossline agreement unless it
 * has been superseded, or it is a re-run that is not yet Delivered.
 */
export function lineCounts(line: CoverageLine): boolean {
  if (line.status === 'Superseded') return false;
  if (line.rerun_of !== null && line.status !== 'Delivered') return false;
  return true;
}

/**
 * The one swath rule. A pair of consecutive fixes sweeps only while the same line
 * was Running, within the fix gap, at or under the speed limit, and on heading.
 */
export function pairSweeps(
  from: CoverageFix,
  to: CoverageFix,
  line: CoverageLine,
  mission: MissionGeometry,
): boolean {
  if (from.line_id === null || from.line_id !== to.line_id) return false;
  const gap = to.t - from.t;
  if (!(gap > 0 && gap <= MAX_FIX_GAP_S)) return false;
  if (to.speed_mps > SWEEP_SPEED_FACTOR * mission.planned_speed_mps) return false;
  const direction = lineDirectionDeg(line.kind, mission.line_azimuth_deg);
  return headingDeviation(to.heading_deg, direction) <= SWEEP_HEADING_TOLERANCE_DEG;
}

/** Cells whose centre lies within the swath rectangle along from→to. */
function swathCells(grid: Grid, from: CoverageFix, to: CoverageFix, halfWidth: number): number[] {
  const dirE = to.easting - from.easting;
  const dirN = to.northing - from.northing;
  const length = Math.hypot(dirE, dirN);
  if (length === 0) return [];
  const unitE = dirE / length;
  const unitN = dirN / length;
  const minE = Math.min(from.easting, to.easting) - halfWidth;
  const maxE = Math.max(from.easting, to.easting) + halfWidth;
  const minN = Math.min(from.northing, to.northing) - halfWidth;
  const maxN = Math.max(from.northing, to.northing) + halfWidth;
  const firstCol = Math.max(0, Math.floor((minE - grid.origin.easting) / CELL_SIZE_M) - 1);
  const lastCol = Math.min(grid.cols - 1, Math.ceil((maxE - grid.origin.easting) / CELL_SIZE_M));
  const firstRow = Math.max(0, Math.floor((minN - grid.origin.northing) / CELL_SIZE_M) - 1);
  const lastRow = Math.min(grid.rows - 1, Math.ceil((maxN - grid.origin.northing) / CELL_SIZE_M));
  const cells: number[] = [];
  for (let r = firstRow; r <= lastRow; r += 1) {
    for (let c = firstCol; c <= lastCol; c += 1) {
      const index = r * grid.cols + c;
      if (!grid.inArea[index]) continue;
      const centre = cellCentre(grid.origin, c, r);
      const offsetE = centre.easting - from.easting;
      const offsetN = centre.northing - from.northing;
      const alongDistance = offsetE * unitE + offsetN * unitN;
      if (alongDistance < 0 || alongDistance > length) continue;
      const acrossDistance = Math.abs(offsetE * -unitN + offsetN * unitE);
      if (acrossDistance > halfWidth) continue;
      cells.push(index);
    }
  }
  return cells;
}

/**
 * Derives the coverage grid, covered length per line, per-line swept depths and
 * crossline agreement from the mission's accepted fixes. Every counter and every
 * screen reads these values rather than deriving its own.
 */
export function computeCoverage(
  mission: MissionGeometry,
  lines: CoverageLine[],
  fixes: CoverageFix[],
): CoverageResult {
  const grid = buildGrid(mission.survey_area);
  const byId = new Map(lines.map((line) => [line.id, line]));
  const coveredByLine = new Map<string, number>();
  const depthByLine = new Map<string, Map<number, { sum: number; count: number }>>();
  const cellLines = new Map<number, Set<string>>();
  const sweeps: Sweep[] = [];

  for (const line of lines) coveredByLine.set(line.id, 0);

  const byVessel = new Map<string, CoverageFix[]>();
  for (const fix of fixes) {
    const list = byVessel.get(fix.vessel_id);
    if (list) list.push(fix);
    else byVessel.set(fix.vessel_id, [fix]);
  }

  for (const vesselFixes of byVessel.values()) {
    vesselFixes.sort((a, b) => a.t - b.t);
    for (let i = 1; i < vesselFixes.length; i += 1) {
      const from = vesselFixes[i - 1]!;
      const to = vesselFixes[i]!;
      const line = to.line_id ? byId.get(to.line_id) : undefined;
      if (!line) continue;
      if (!pairSweeps(from, to, line, mission)) continue;
      const segment = Math.hypot(to.easting - from.easting, to.northing - from.northing);
      coveredByLine.set(line.id, (coveredByLine.get(line.id) ?? 0) + segment);
      sweeps.push({ lineId: line.id, from, to, length: segment });
      if (!lineCounts(line)) continue;
      const halfWidth = (to.depth_m * mission.swath_ratio) / 2;
      let depths = depthByLine.get(line.id);
      if (!depths) {
        depths = new Map();
        depthByLine.set(line.id, depths);
      }
      for (const cell of swathCells(grid, from, to, halfWidth)) {
        let set = cellLines.get(cell);
        if (!set) {
          set = new Set();
          cellLines.set(cell, set);
        }
        set.add(line.id);
        const entry = depths.get(cell);
        if (entry) {
          entry.sum += to.depth_m;
          entry.count += 1;
        } else {
          depths.set(cell, { sum: to.depth_m, count: 1 });
        }
      }
    }
  }

  let coveredCells = 0;
  for (const [cell, set] of cellLines) {
    const row = Math.floor(cell / grid.cols);
    const col = cell % grid.cols;
    grid.overlap[row]![col] = set.size;
    if (set.size > 0) coveredCells += 1;
  }

  const meanDepths = new Map<string, Map<number, number>>();
  for (const [lineId, cells] of depthByLine) {
    const means = new Map<number, number>();
    for (const [cell, entry] of cells) means.set(cell, entry.sum / entry.count);
    meanDepths.set(lineId, means);
  }

  return {
    grid,
    coveragePct:
      grid.areaCellCount === 0 ? 0 : roundHalfUp((coveredCells / grid.areaCellCount) * 100, 1),
    coveredByLine,
    depthByLine: meanDepths,
    sweeps,
    crosslineAgreement: computeCrosslineAgreement(mission, lines, meanDepths),
  };
}

/**
 * Crossline agreement: one comparison per area cell for each crossline and
 * mainscheme line that both have a swept depth there.
 */
export function computeCrosslineAgreement(
  mission: MissionGeometry,
  lines: CoverageLine[],
  depths: Map<string, Map<number, number>>,
): CrosslineAgreement {
  const { a, b } = ORDER_COEFFICIENTS[mission.survey_order];
  const crosslines = lines.filter((line) => line.kind === 'crossline' && lineCounts(line));
  const mainscheme = lines.filter((line) => line.kind === 'planned' && lineCounts(line));
  let compared = 0;
  let within = 0;
  for (const crossline of crosslines) {
    const crosslineDepths = depths.get(crossline.id);
    if (!crosslineDepths) continue;
    for (const main of mainscheme) {
      const mainDepths = depths.get(main.id);
      if (!mainDepths) continue;
      for (const [cell, crosslineDepth] of crosslineDepths) {
        const mainDepth = mainDepths.get(cell);
        if (mainDepth === undefined) continue;
        compared += 1;
        const allowed = Math.sqrt(a * a + (b * ((crosslineDepth + mainDepth) / 2)) ** 2);
        if (Math.abs(crosslineDepth - mainDepth) <= allowed) within += 1;
      }
    }
  }
  if (compared === 0) return { compared: 0, within: 0, pct: null, meets_order: null };
  const pct = roundHalfUp((within / compared) * 100, 1);
  return { compared, within, pct, meets_order: pct >= 95.0 };
}

/** A line's coverage percentage, capped at 100. */
export function lineCoveragePct(coveredM: number, lengthM: number): number {
  if (lengthM <= 0) return 0;
  return Math.min(100, (coveredM / lengthM) * 100);
}

export interface StripOwner {
  lineId: string;
  status: LineStatus;
  offset: number;
}

/**
 * Each mainscheme line owns a strip of cells chosen by the across-line offset of
 * the cell centre. Boundaries sit halfway between neighbouring lines, a cell on a
 * boundary belongs to the higher-offset line, and the outer strips reach the area
 * edges.
 */
export function stripOwners(mission: MissionGeometry, lines: CoverageLine[]): StripOwner[] {
  const { across } = directions(mission.line_azimuth_deg);
  const base = spread(mission.survey_area, across).min;
  return lines
    .filter((line) => line.kind === 'planned' && lineCounts(line))
    .map((line) => ({
      lineId: line.id,
      status: line.status,
      offset: project(line.start, across) - base,
    }))
    .sort((a, b) => a.offset - b.offset);
}

export function ownerOfCell(
  owners: StripOwner[],
  centre: Position,
  across: Vec,
  base: number,
): StripOwner | null {
  if (owners.length === 0) return null;
  const offset = project(centre, across) - base;
  for (let i = 0; i < owners.length - 1; i += 1) {
    const boundary = (owners[i]!.offset + owners[i + 1]!.offset) / 2;
    if (offset < boundary) return owners[i]!;
  }
  return owners[owners.length - 1]!;
}

export interface CellGroup {
  cells: number[];
  qualifies: boolean;
}

/**
 * Uncovered area cells whose strip owner is Surveyed or Delivered, grouped by
 * shared edges. A group is a holiday only with a straight run of three cells;
 * every other group is a speck.
 */
export function findHolidayGroups(
  mission: MissionGeometry,
  lines: CoverageLine[],
  grid: Grid,
): CellGroup[] {
  const owners = stripOwners(mission, lines);
  const { across } = directions(mission.line_azimuth_deg);
  const base = spread(mission.survey_area, across).min;
  const holidayCell = new Array<boolean>(grid.cols * grid.rows).fill(false);
  for (let r = 0; r < grid.rows; r += 1) {
    for (let c = 0; c < grid.cols; c += 1) {
      const index = r * grid.cols + c;
      if (!grid.inArea[index]) continue;
      if (grid.overlap[r]![c]! > 0) continue;
      const owner = ownerOfCell(owners, cellCentre(grid.origin, c, r), across, base);
      if (!owner) continue;
      if (owner.status !== 'Surveyed' && owner.status !== 'Delivered') continue;
      holidayCell[index] = true;
    }
  }

  const seen = new Array<boolean>(grid.cols * grid.rows).fill(false);
  const groups: CellGroup[] = [];
  for (let start = 0; start < holidayCell.length; start += 1) {
    if (!holidayCell[start] || seen[start]) continue;
    const cells: number[] = [];
    const stack = [start];
    seen[start] = true;
    while (stack.length > 0) {
      const index = stack.pop()!;
      cells.push(index);
      const row = Math.floor(index / grid.cols);
      const col = index % grid.cols;
      const neighbours = [
        col > 0 ? index - 1 : -1,
        col < grid.cols - 1 ? index + 1 : -1,
        row > 0 ? index - grid.cols : -1,
        row < grid.rows - 1 ? index + grid.cols : -1,
      ];
      for (const neighbour of neighbours) {
        if (neighbour >= 0 && holidayCell[neighbour] && !seen[neighbour]) {
          seen[neighbour] = true;
          stack.push(neighbour);
        }
      }
    }
    cells.sort((a, b) => a - b);
    groups.push({ cells, qualifies: hasStraightRun(cells, grid.cols) });
  }
  return groups;
}

/** True when the cells hold three consecutive cols in one row or three rows in one col. */
export function hasStraightRun(cells: number[], cols: number): boolean {
  const set = new Set(cells);
  for (const index of cells) {
    const col = index % cols;
    if (col + 2 < cols && set.has(index + 1) && set.has(index + 2)) return true;
    if (set.has(index + cols) && set.has(index + 2 * cols)) return true;
  }
  return false;
}

export function groupCentroid(grid: Grid, cells: number[]): Position {
  let east = 0;
  let north = 0;
  for (const index of cells) {
    const centre = cellCentre(grid.origin, index % grid.cols, Math.floor(index / grid.cols));
    east += centre.easting;
    north += centre.northing;
  }
  return { easting: east / cells.length, northing: north / cells.length };
}

export function cellPairs(grid: Grid, cells: number[]): [number, number][] {
  return cells.map((index) => [index % grid.cols, Math.floor(index / grid.cols)]);
}

export function cellIndex(grid: Grid, col: number, row: number): number {
  return row * grid.cols + col;
}
