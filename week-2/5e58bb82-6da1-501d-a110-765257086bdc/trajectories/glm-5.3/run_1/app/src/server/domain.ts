
export interface Position { easting: number; northing: number }
export type SurveyOrder = 'special' | '1a';

export const SURVEY_ORDERS: Record<SurveyOrder, { a: number; b: number }> = {
  special: { a: 0.25, b: 0.0075 },
  '1a': { a: 0.5, b: 0.013 },
};

export function roundHalfUp(n: number, dp = 0): number {
  const f = 10 ** dp;
  // JS Math.round rounds .5 toward +Inf; compensate for negatives
  return Math.sign(n) * Math.round(Math.abs(n) * f + Number.EPSILON * Math.abs(n) * f) / f;
}

export function roundHalfAway(n: number, dp = 0): number {
  const f = 10 ** dp;
  return Math.sign(n) * Math.round(Math.abs(n) * f + Number.EPSILON * Math.abs(n) * f) / f;
}

export function polygonArea(pts: Position[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!;
    const q = pts[(i + 1) % pts.length]!;
    a += p.easting * q.northing - q.easting * p.northing;
  }
  return Math.abs(a) / 2;
}

export function isConvex(pts: Position[]): boolean {
  const n = pts.length;
  if (n < 3) return false;
  let sign = 0;
  for (let i = 0; i < n; i++) {
    const a = pts[i]!;
    const b = pts[(i + 1) % n]!;
    const c = pts[(i + 2) % n]!;
    const cross = (b.easting - a.easting) * (c.northing - b.northing) - (b.northing - a.northing) * (c.easting - b.easting);
    if (Math.abs(cross) < 1e-12) continue;
    const s = Math.sign(cross);
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return sign !== 0;
}

export function pointInPolygon(p: Position, poly: Position[]): boolean {
  let inside = false;
  const n = poly.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    if (a.easting === p.easting && a.northing === p.northing) return true;
    if (((a.northing > p.northing) !== (b.northing > p.northing)) &&
      (p.easting <= (b.easting - a.easting) * (p.northing - a.northing) / (b.northing - a.northing) + a.easting)) {
      inside = !inside;
    }
  }
  return inside;
}

export function pointOnEdge(p: Position, poly: Position[]): boolean {
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % n]!;
    const cross = (b.easting - a.easting) * (p.northing - a.northing) - (b.northing - a.northing) * (p.easting - a.easting);
    if (Math.abs(cross) > 1e-9) continue;
    const dot = (p.easting - a.easting) * (b.easting - a.easting) + (p.northing - a.northing) * (b.northing - a.northing);
    if (dot < -1e-9) continue;
    const len2 = (b.easting - a.easting) ** 2 + (b.northing - a.northing) ** 2;
    if (dot <= len2 + 1e-9) return true;
  }
  return false;
}

export function pointInsideOrOnEdge(p: Position, poly: Position[]): boolean {
  return pointOnEdge(p, poly) || pointInPolygon(p, poly);
}

function hasRepeatedVertex(pts: Position[]): boolean {
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      if (pts[i]!.easting === pts[j]!.easting && pts[i]!.northing === pts[j]!.northing) return true;
    }
  }
  return false;
}

// ---------- Line plan derivation ----------

export interface PlanSettings {
  planned_depth_m: number;
  swath_ratio: number;
  overlap_pct: number;
  line_azimuth_deg: number;
  planned_speed_mps: number;
  survey_order: SurveyOrder;
}

export interface DerivedLine {
  label: string;
  kind: 'planned' | 'crossline';
  start: Position;
  end: Position;
  length_m: number;
}

export interface LinePlan {
  swath_width_m: number;
  line_spacing_m: number;
  lines: DerivedLine[];
  crosslines: DerivedLine[];
  line_count: number;
  crossline_count: number;
  estimated_duration_s: number;
}

function chordThroughPolygon(area: Position[], through: Position, along: { x: number; y: number }, across: { x: number; y: number }): { a: Position; b: Position } | null {
  // Intersect the infinite line through `through` with direction `along` with the polygon edges.
  const pts: Position[] = [];
  const n = area.length;
  for (let i = 0; i < n; i++) {
    const p1 = area[i]!;
    const p2 = area[(i + 1) % n]!;
    const d = { x: p2.easting - p1.easting, y: p2.northing - p1.northing };
    const den = d.x * along.y - d.y * along.x;
    if (Math.abs(den) < 1e-12) continue; // edge parallel to the line
    // Solve p1 + t*d = through + u*along for t; u is unconstrained (infinite line).
    const t = ((through.easting - p1.easting) * along.y - (through.northing - p1.northing) * along.x) / den;
    if (t >= -1e-9 && t <= 1 + 1e-9) {
      pts.push({ easting: p1.easting + t * d.x, northing: p1.northing + t * d.y });
    }
  }
  if (pts.length < 2) return null;
  // Deduplicate and take extremes
  const sorted = pts.sort((u, v) => u.easting - v.easting || u.northing - v.northing);
  const uniq: Position[] = [sorted[0]!];
  for (const p of sorted) {
    const l = uniq[uniq.length - 1]!;
    if (Math.hypot(p.easting - l.easting, p.northing - l.northing) > 1e-7) uniq.push(p);
  }
  if (uniq.length < 2) return null;
  const a = uniq[0]!;
  const b = uniq[uniq.length - 1]!;
  return { a, b };
}

export function derivePlan(area: Position[], settings: PlanSettings): LinePlan {
  const W = settings.planned_depth_m * settings.swath_ratio;
  const S = W * (1 - settings.overlap_pct / 100);
  const a = settings.line_azimuth_deg;
  const along = { x: Math.sin(a * Math.PI / 180), y: Math.cos(a * Math.PI / 180) };
  const across = { x: Math.cos(a * Math.PI / 180), y: -Math.sin(a * Math.PI / 180) };

  const projs = area.map(p => p.easting * across.x + p.northing * across.y);
  const minP = Math.min(...projs);
  const D = Math.max(...projs) - minP;

  const lines: DerivedLine[] = [];
  const offsets: number[] = [];
  if (D <= W) {
    offsets.push(D / 2);
  } else {
    const n = 1 + Math.ceil((D - W) / S - 1e-9);
    for (let i = 0; i < n; i++) {
      offsets.push(i === n - 1 ? D - W / 2 : W / 2 + i * S);
    }
  }

  for (let i = 0; i < offsets.length; i++) {
    const off = minP + offsets[i]!;
    const cx = across.x * off, cy = across.y * off;
    // Line through the origin-anchored across offset: point on line = (across.x*off, across.y*off)
    const through: Position = { easting: cx, northing: cy };
    const chord = chordThroughPolygon(area, through, along, across);
    if (!chord) continue;
    const pa = chord.a.easting * along.x + chord.a.northing * along.y;
    const pb = chord.b.easting * along.x + chord.b.northing * along.y;
    const start = pa <= pb ? chord.a : chord.b;
    const end = pa <= pb ? chord.b : chord.a;
    const length = Math.hypot(end.easting - start.easting, end.northing - start.northing);
    lines.push({
      label: `L${String(i + 1).padStart(2, '0')}`,
      kind: 'planned',
      start, end, length_m: length,
    });
  }

  const L = lines.reduce((s, l) => s + l.length_m, 0);

  // Crosslines: chords along `across` direction at along-line offsets.
  const alongProjs = area.map(p => p.easting * along.x + p.northing * along.y);
  const minA = Math.min(...alongProjs);
  const E = Math.max(...alongProjs) - minA;

  const crosslines: DerivedLine[] = [];
  if (L > 0) {
    let k = 1;
    for (; k <= 200; k++) {
      let total = 0;
      const chords: { a: Position; b: Position }[] = [];
      for (let j = 0; j < k; j++) {
        const off = minA + E * (j + 1) / (k + 1);
        const through: Position = { easting: along.x * off, northing: along.y * off };
        const chord = chordThroughPolygon(area, through, across, along);
        if (chord) {
          const len = Math.hypot(chord.b.easting - chord.a.easting, chord.b.northing - chord.a.northing);
          total += len;
          chords.push(chord);
        }
      }
      if (total >= 0.05 * L) {
        for (let j = 0; j < chords.length; j++) {
          const chord = chords[j]!;
          const pa = chord.a.easting * across.x + chord.a.northing * across.y;
          const pb = chord.b.easting * across.x + chord.b.northing * across.y;
          const start = pa <= pb ? chord.a : chord.b;
          const end = pa <= pb ? chord.b : chord.a;
          crosslines.push({
            label: `X${String(j + 1).padStart(2, '0')}`,
            kind: 'crossline',
            start, end,
            length_m: Math.hypot(end.easting - start.easting, end.northing - start.northing),
          });
        }
        break;
      }
    }
  }

  const n = lines.length;
  const totalLen = L + crosslines.reduce((s, c) => s + c.length_m, 0);
  const estimated_duration_s = roundHalfUp(totalLen / settings.planned_speed_mps + 60 * (n + crosslines.length - 1));

  return {
    swath_width_m: W,
    line_spacing_m: S,
    lines, crosslines,
    line_count: lines.length,
    crossline_count: crosslines.length,
    estimated_duration_s,
  };
}

export function validatePlanInput(input: {
  name?: unknown; client_org_id?: unknown; survey_date?: unknown;
  survey_area?: unknown; geofence?: unknown;
  planned_depth_m?: unknown; swath_ratio?: unknown; overlap_pct?: unknown;
  line_azimuth_deg?: unknown; planned_speed_mps?: unknown; survey_order?: unknown;
  requireName: boolean; requireOrg: boolean; requireDate: boolean;
  requireGeofence?: boolean;
}): Map<string, string> {
  const errors = new Map<string, string>();
  const num = (v: unknown): number | null => typeof v === 'number' && Number.isFinite(v) ? v : null;
  if (input.requireName) {
    if (typeof input.name !== 'string' || input.name.length < 1 || input.name.length > 80) errors.set('name', 'Enter a mission name of up to 80 characters');
  }
  if (input.requireDate) {
    const d = typeof input.survey_date === 'string' ? input.survey_date : '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !isRealDate(d)) errors.set('survey_date', 'Enter the survey date as YYYY-MM-DD');
  }
  const parsePts = (v: unknown): Position[] | null => {
    if (!Array.isArray(v)) return null;
    const out: Position[] = [];
    for (const p of v) {
      if (typeof p !== 'object' || p === null) return null;
      const o = p as Record<string, unknown>;
      if (typeof o.easting !== 'number' || typeof o.northing !== 'number' || !Number.isFinite(o.easting) || !Number.isFinite(o.northing)) return null;
      out.push({ easting: o.easting, northing: o.northing });
    }
    return out;
  };
  const area = parsePts(input.survey_area);
  const fence = parsePts(input.geofence);
  if (!area || area.length < 3 || area.length > 40) errors.set('survey_area', 'Enter 3 to 40 survey-area vertices as easting, northing');
  else {
    if (!isConvex(area) || polygonArea(area) <= 0 || hasRepeatedVertex(area)) errors.set('survey_area', 'The survey area must be a convex shape');
    else if (polygonArea(area) > 4_000_000 + 1e-9) errors.set('survey_area', 'The survey area must be at most 4,000,000 m²');
  }
  if (input.requireGeofence !== false) {
    if (!fence || fence.length < 3 || fence.length > 40) errors.set('geofence', 'Enter 3 to 40 geofence corners as easting, northing');
    else {
      if (!isConvex(fence)) errors.set('geofence', 'The geofence must be a convex shape');
      else if (area && !area.every(p => pointInsideOrOnEdge(p, fence))) errors.set('geofence', 'The geofence must enclose the survey area');
    }
  }
  const depth = num(input.planned_depth_m);
  if (depth === null || depth < 1 || depth > 200) errors.set('planned_depth_m', 'Planned depth must be between 1 and 200 m');
  const ratio = num(input.swath_ratio);
  if (ratio === null || ratio < 1 || ratio > 8) errors.set('swath_ratio', 'Swath ratio must be between 1 and 8');
  const overlap = num(input.overlap_pct);
  if (overlap === null || overlap < 0 || overlap > 50) errors.set('overlap_pct', 'Overlap must be between 0 and 50 %');
  const az = num(input.line_azimuth_deg);
  if (az === null || az < 0 || az >= 180) errors.set('line_azimuth_deg', 'Line azimuth must be at least 0° and below 180°');
  const speed = num(input.planned_speed_mps);
  if (speed === null || speed < 0.5 || speed > 4) errors.set('planned_speed_mps', 'Planned speed must be between 0.5 and 4 m/s');
  if (input.survey_order !== undefined && input.survey_order !== null && input.survey_order !== 'special' && input.survey_order !== '1a') {
    errors.set('survey_order', 'Choose Special Order or Order 1a');
  }
  return errors;
}

function isRealDate(s: string): boolean {
  const [y, m, d] = s.split('-').map(Number);
  if (!y || !m || !d) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function isRealDateString(s: string): boolean { return isRealDate(s); }

// ---------- Coverage grid ----------

export const CELL_SIZE = 5;

export interface CoverageGridSpec {
  origin: Position;
  cols: number;
  rows: number;
  cells: Set<number>; // r * 100000 + c? no: use string keys "c,r" — store as number r*cols+c
}

export function gridSpec(area: Position[]): { origin: Position; cols: number; rows: number } {
  const eMin = Math.min(...area.map(p => p.easting));
  const nMin = Math.min(...area.map(p => p.northing));
  const eMax = Math.max(...area.map(p => p.easting));
  const nMax = Math.max(...area.map(p => p.northing));
  const originE = Math.floor(eMin / CELL_SIZE) * CELL_SIZE;
  const originN = Math.floor(nMin / CELL_SIZE) * CELL_SIZE;
  const east = Math.ceil(eMax / CELL_SIZE) * CELL_SIZE;
  const north = Math.ceil(nMax / CELL_SIZE) * CELL_SIZE;
  return {
    origin: { easting: originE, northing: originN },
    cols: Math.max(1, Math.round((east - originE) / CELL_SIZE)),
    rows: Math.max(1, Math.round((north - originN) / CELL_SIZE)),
  };
}

export function cellCentre(origin: Position, c: number, r: number): Position {
  return { easting: origin.easting + CELL_SIZE * c + 2.5, northing: origin.northing + CELL_SIZE * r + 2.5 };
}

export function areaCells(area: Position[], origin: Position, cols: number, rows: number): Set<number> {
  const set = new Set<number>();
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const centre = cellCentre(origin, c, r);
      if (pointInsideOrOnEdge(centre, area)) set.add(r * cols + c);
    }
  }
  return set;
}

// ---------- Swath ----------

export interface FixLike {
  t: Date; easting: number; northing: number; heading_deg: number;
  speed_mps: number; depth_m: number;
}

export function sweepsSwath(a: FixLike, b: FixLike, plannedSpeed: number, lineDirectionDeg: number): boolean {
  const dt = (b.t.getTime() - a.t.getTime()) / 1000;
  if (!(dt > 0 && dt <= 60)) return false;
  if (b.speed_mps > 1.5 * plannedSpeed + 1e-9) return false;
  const d = b.heading_deg - lineDirectionDeg;
  const delta = ((d % 180) + 180) % 180;
  const deviation = Math.min(delta, 180 - delta);
  return deviation <= 20 + 1e-9;
}

export function swathCells(a: FixLike, b: FixLike, depthB: number, swathRatio: number, origin: Position, cols: number, rows: number): number[] {
  // Rectangle along A->B with half-width depthB*ratio/2.
  const half = depthB * swathRatio / 2;
  const dx = b.easting - a.easting, dy = b.northing - a.northing;
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return [];
  const ux = dx / len, uy = dy / len;
  const px = -uy, py = ux; // perpendicular
  const out: number[] = [];
  // Bounding box of the segment expanded by half-width
  const minE = Math.min(a.easting, b.easting) - half, maxE = Math.max(a.easting, b.easting) + half;
  const minN = Math.min(a.northing, b.northing) - half, maxN = Math.max(a.northing, b.northing) + half;
  const c0 = Math.max(0, Math.floor((minE - origin.easting) / CELL_SIZE));
  const c1 = Math.min(cols - 1, Math.floor((maxE - origin.easting) / CELL_SIZE));
  const r0 = Math.max(0, Math.floor((minN - origin.northing) / CELL_SIZE));
  const r1 = Math.min(rows - 1, Math.floor((maxN - origin.northing) / CELL_SIZE));
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      const centre = cellCentre(origin, c, r);
      const relx = centre.easting - a.easting, rely = centre.northing - a.northing;
      const proj = relx * ux + rely * uy;
      if (proj < -1e-9 || proj > len + 1e-9) continue;
      const perp = Math.abs(relx * px + rely * py);
      if (perp <= half + 1e-9) out.push(r * cols + c);
    }
  }
  return out;
}

// ---------- Link state ----------

export type LinkState = 'Live' | 'Stale' | 'Lost';

export function linkStateFromAge(ageSeconds: number | null): LinkState {
  if (ageSeconds === null) return 'Lost';
  if (ageSeconds < 10) return 'Live';
  if (ageSeconds <= 60) return 'Stale';
  return 'Lost';
}

// ---------- Crossline agreement ----------

export function crosslineAgreementCompute(compared: number, within: number, order: SurveyOrder): { compared: number; within: number; pct: number | null; meets_order: boolean | null } {
  if (compared === 0) return { compared, within, pct: null, meets_order: null };
  const pct = roundHalfUp(within / compared * 100, 1);
  return { compared, within, pct, meets_order: pct >= 95.0 };
}

export function withinUncertainty(dX: number, dL: number, order: SurveyOrder): boolean {
  const { a, b } = SURVEY_ORDERS[order];
  const limit = Math.sqrt(a * a + (b * ((dX + dL) / 2)) ** 2);
  return Math.abs(dX - dL) <= limit;
}

// ---------- Infill geometry ----------

export function infillGeometry(
  holidayCells: { col: number; row: number }[],
  centroid: Position,
  area: Position[],
  azimuthDeg: number,
  origin: Position,
): { start: Position; end: Position } | null {
  const a = azimuthDeg * Math.PI / 180;
  const along = { x: Math.sin(a), y: Math.cos(a) };
  const across = { x: Math.cos(a), y: -Math.sin(a) };
  const through: Position = centroid;
  const chord = chordThroughPolygon(area, through, along, across);
  if (!chord) return null;
  // Along-line projections of holiday cell centres
  let minS = Infinity, maxS = -Infinity;
  for (const cell of holidayCells) {
    const centre = cellCentre(origin, cell.col, cell.row);
    const s = centre.easting * along.x + centre.northing * along.y;
    minS = Math.min(minS, s); maxS = Math.max(maxS, s);
  }
  const pa = chord.a.easting * along.x + chord.a.northing * along.y;
  const pb = chord.b.easting * along.x + chord.b.northing * along.y;
  const lo = pa <= pb ? chord.a : chord.b;
  const hi = pa <= pb ? chord.b : chord.a;
  const dirx = hi.easting - lo.easting, diry = hi.northing - lo.northing;
  const len = Math.hypot(dirx, diry) || 1;
  const ux = dirx / len, uy = diry / len;
  const s0 = Math.max(minS - 10, Math.min(pa, pb));
  const s1 = Math.min(maxS + 10, Math.max(pa, pb));
  const start: Position = { easting: lo.easting + ux * (s0 - Math.min(pa, pb)), northing: lo.northing + uy * (s0 - Math.min(pa, pb)) };
  const end: Position = { easting: lo.easting + ux * (s1 - Math.min(pa, pb)), northing: lo.northing + uy * (s1 - Math.min(pa, pb)) };
  return { start, end };
}

export function stripOwnerOffset(centre: Position, azimuthDeg: number): number {
  const a = azimuthDeg * Math.PI / 180;
  const across = { x: Math.cos(a), y: -Math.sin(a) };
  return centre.easting * across.x + centre.northing * across.y;
}

export function holidayQualifies(cells: { col: number; row: number }[]): boolean {
  // connected group with a straight run of >= 3 consecutive cells in one row or one column
  const has = (c: number, r: number) => cells.some(x => x.col === c && x.row === r);
  for (const cell of cells) {
    // horizontal run starting here
    if (has(cell.col + 1, cell.row) && has(cell.col + 2, cell.row)) return true;
    if (has(cell.col, cell.row + 1) && has(cell.col, cell.row + 2)) return true;
  }
  return false;
}
