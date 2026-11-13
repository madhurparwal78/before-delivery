import { nearly, nearlyZero, round6, round6Point, TOLERANCE } from './num.js';

export interface Pt {
  x: number;
  y: number;
}

export const LAYER_COLOURS = ['white', 'red', 'yellow', 'green', 'cyan', 'blue', 'magenta', 'grey'] as const;
export type LayerColour = (typeof LAYER_COLOURS)[number];

export const LINETYPES = ['Continuous', 'Dashed', 'Dotted', 'Centre'] as const;
export type Linetype = (typeof LINETYPES)[number];

export const LINEWEIGHTS = [0.13, 0.18, 0.25, 0.35, 0.5, 0.7] as const;
export type Lineweight = (typeof LINEWEIGHTS)[number];

export const COLOUR_HEX: Record<string, string> = {
  white: '#ece7db',
  red: '#d98a80',
  yellow: '#d9c37f',
  green: '#8fae77',
  cyan: '#84b6bd',
  blue: '#8298b8',
  magenta: '#b28ab5',
  grey: '#7d8579',
};

export type EntityGeom =
  | { type: 'line'; x1: number; y1: number; x2: number; y2: number }
  | { type: 'circle'; cx: number; cy: number; r: number }
  | { type: 'arc'; cx: number; cy: number; r: number; start: number; end: number }
  | { type: 'pline'; points: Pt[]; closed: boolean }
  | { type: 'insert'; block: string; x: number; y: number; scale: number; rotation: number; attributes: Record<string, string> }
  | { type: 'hatch'; seed_x: number; seed_y: number }
  | {
      type: 'dimension';
      kind: DimensionKind;
      style: string;
      refs: DimensionRef[];
      override: string | null;
      text_x: number;
      text_y: number;
    };

export type DimensionKind = 'linear' | 'aligned' | 'angular' | 'radial';

export interface DimensionRef {
  handle: string;
  point: 'start' | 'end' | 'centre';
}

export type EntityStyle = {
  colour: 'ByLayer' | 'ByBlock' | LayerColour;
  linetype: 'ByLayer' | Linetype;
  lineweight: 'ByLayer' | number;
};

export interface EntityBase {
  handle: string;
  layer: string;
}

export type Entity = EntityBase & EntityGeom;

// An entity plus its derived fields. Hatch areas, dimension values and the
// association flags are computed, never authored.
export type ResolvedEntity =
  | (EntityBase & Exclude<EntityGeom, { type: 'hatch' } | { type: 'dimension' }>)
  | (EntityBase & { type: 'hatch'; seed_x: number; seed_y: number; area: number; associative: boolean; polygon?: Pt[]; boundary_handles?: string[] })
  | (EntityBase & {
      type: 'dimension';
      kind: DimensionKind;
      style: string;
      refs: DimensionRef[];
      override: string | null;
      text_x: number;
      text_y: number;
      value: number | null;
      associative: boolean;
    });

export const HANDLE_LETTERS: Record<Entity['type'], string> = {
  line: 'L',
  pline: 'P',
  circle: 'C',
  arc: 'A',
  hatch: 'H',
  dimension: 'D',
  insert: 'I',
};

export interface BBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

const BIG = Number.MAX_SAFE_INTEGER;

export function entityBounds(entity: Entity | ResolvedEntity): BBox {
  switch (entity.type) {
    case 'line':
      return { minX: Math.min(entity.x1, entity.x2), minY: Math.min(entity.y1, entity.y2), maxX: Math.max(entity.x1, entity.x2), maxY: Math.max(entity.y1, entity.y2) };
    case 'circle':
      return { minX: entity.cx - entity.r, minY: entity.cy - entity.r, maxX: entity.cx + entity.r, maxY: entity.cy + entity.r };
    case 'arc':
      return arcBounds(entity.cx, entity.cy, entity.r, entity.start, entity.end);
    case 'pline': {
      let minX = BIG, minY = BIG, maxX = -BIG, maxY = -BIG;
      for (const p of entity.points) {
        minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
      }
      return { minX, minY, maxX, maxY };
    }
    case 'insert':
      return { minX: entity.x, minY: entity.y, maxX: entity.x, maxY: entity.y };
    case 'hatch':
      return { minX: entity.seed_x, minY: entity.seed_y, maxX: entity.seed_x, maxY: entity.seed_y };
    case 'dimension':
      return { minX: entity.text_x, minY: entity.text_y, maxX: entity.text_x, maxY: entity.text_y };
  }
}

export function arcBounds(cx: number, cy: number, r: number, start: number, end: number): BBox {
  let minX = BIG, minY = BIG, maxX = -BIG, maxY = -BIG;
  const step = Math.max(0.5, 360 / Math.max(8, Math.ceil((end - start) / 4)));
  for (let a = start; a <= end + 1e-9; a += step) {
    const x = cx + r * Math.cos((a * Math.PI) / 180);
    const y = cy + r * Math.sin((a * Math.PI) / 180);
    minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
  }
  return { minX, minY, maxX, maxY };
}

export function segmentPoints(entity: Entity | ResolvedEntity): Pt[] {
  switch (entity.type) {
    case 'line':
      return [{ x: entity.x1, y: entity.y1 }, { x: entity.x2, y: entity.y2 }];
    case 'arc': {
      const pts: Pt[] = [];
      const step = Math.max(0.5, 360 / Math.max(8, Math.ceil((entity.end - entity.start) / 4)));
      for (let a = entity.start; a <= entity.end + 1e-9; a += step) {
        pts.push({ x: entity.cx + entity.r * Math.cos((a * Math.PI) / 180), y: entity.cy + entity.r * Math.sin((a * Math.PI) / 180) });
      }
      return pts.length ? pts : [arcStart(entity), arcEnd(entity)];
    }
    case 'circle': {
      const pts: Pt[] = [];
      for (let a = 0; a < 360; a += 10) pts.push({ x: entity.cx + entity.r * Math.cos((a * Math.PI) / 180), y: entity.cy + entity.r * Math.sin((a * Math.PI) / 180) });
      return pts;
    }
    case 'pline':
      return entity.points;
    default:
      return [];
  }
}

export function lineLength(x1: number, y1: number, x2: number, y2: number): number {
  return Math.hypot(x2 - x1, y2 - y1);
}

export function arcStart(entity: Extract<Entity, { type: 'arc' }>): Pt {
  return { x: entity.cx + entity.r * Math.cos((entity.start * Math.PI) / 180), y: entity.cy + entity.r * Math.sin((entity.start * Math.PI) / 180) };
}

export function arcEnd(entity: Extract<Entity, { type: 'arc' }>): Pt {
  return { x: entity.cx + entity.r * Math.cos((entity.end * Math.PI) / 180), y: entity.cy + entity.r * Math.sin((entity.end * Math.PI) / 180) };
}

export function polylineLength(entity: Extract<Entity, { type: 'pline' }>): number {
  let total = 0;
  const pts = entity.points;
  const last = entity.closed ? pts.length : pts.length - 1;
  for (let i = 0; i < last; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    total += lineLength(a.x, a.y, b.x, b.y);
  }
  return total;
}

export function arcLength(entity: Extract<Entity, { type: 'arc' }>): number {
  return (entity.r * (entity.end - entity.start) * Math.PI) / 180;
}

export function arcSegmentArea(r: number, thetaRad: number): number {
  return (r * r / 2) * (thetaRad - Math.sin(thetaRad));
}

export function circleArea(r: number): number {
  return Math.PI * r * r;
}

export function polygonArea(points: Pt[]): number {
  if (points.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

export function pointInPolygon(p: Pt, polygon: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export function polylinePolygon(entity: Extract<Entity, { type: 'pline' }>): Pt[] {
  return entity.closed ? entity.points : [];
}

export function closedPolylineArea(entity: Extract<Entity, { type: 'pline' }>): number {
  return polygonArea(entity.points);
}

export function entityLength(entity: Entity | ResolvedEntity): number {
  switch (entity.type) {
    case 'line':
      return lineLength(entity.x1, entity.y1, entity.x2, entity.y2);
    case 'pline':
      return polylineLength(entity);
    case 'arc':
      return arcLength(entity);
    default:
      return 0;
  }
}

export function entityMid(entity: Entity | ResolvedEntity): Pt {
  switch (entity.type) {
    case 'line':
      return { x: (entity.x1 + entity.x2) / 2, y: (entity.y1 + entity.y2) / 2 };
    case 'circle':
      return { x: entity.cx, y: entity.cy };
    case 'arc':
      return { x: entity.cx + entity.r * Math.cos((((entity.start + entity.end) / 2) * Math.PI) / 180), y: entity.cy + entity.r * Math.sin((((entity.start + entity.end) / 2) * Math.PI) / 180) };
    case 'pline': {
      const pts = entity.points;
      if (!pts.length) return { x: 0, y: 0 };
      let sx = 0, sy = 0;
      for (const p of pts) { sx += p.x; sy += p.y; }
      return { x: sx / pts.length, y: sy / pts.length };
    }
    case 'insert':
      return { x: entity.x, y: entity.y };
    case 'hatch':
      return { x: entity.seed_x, y: entity.seed_y };
    case 'dimension':
      return { x: entity.text_x, y: entity.text_y };
  }
}

export function entityCentre(entity: Entity | ResolvedEntity): Pt {
  if (entity.type === 'circle' || entity.type === 'arc') return { x: entity.cx, y: entity.cy };
  return entityMid(entity);
}

export function rotatePoint(p: Pt, about: Pt, degrees: number): Pt {
  const rad = (degrees * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = p.x - about.x;
  const dy = p.y - about.y;
  return round6Point({ x: about.x + dx * cos - dy * sin, y: about.y + dx * sin + dy * cos });
}

export function scalePoint(p: Pt, about: Pt, factor: number): Pt {
  return round6Point({ x: about.x + (p.x - about.x) * factor, y: about.y + (p.y - about.y) * factor });
}

export function moveEntity<T extends Entity | ResolvedEntity>(entity: T, dx: number, dy: number): T {
  switch (entity.type) {
    case 'line':
      return { ...entity, x1: round6(entity.x1 + dx), y1: round6(entity.y1 + dy), x2: round6(entity.x2 + dx), y2: round6(entity.y2 + dy) };
    case 'circle':
      return { ...entity, cx: round6(entity.cx + dx), cy: round6(entity.cy + dy) };
    case 'arc':
      return { ...entity, cx: round6(entity.cx + dx), cy: round6(entity.cy + dy) };
    case 'pline':
      return { ...entity, points: entity.points.map((p) => ({ x: round6(p.x + dx), y: round6(p.y + dy) })) };
    case 'insert':
      return { ...entity, x: round6(entity.x + dx), y: round6(entity.y + dy) };
    case 'hatch':
      return { ...entity, seed_x: round6(entity.seed_x + dx), seed_y: round6(entity.seed_y + dy) };
    case 'dimension':
      return { ...entity, text_x: round6(entity.text_x + dx), text_y: round6(entity.text_y + dy) };
  }
}

export function transformEntity<T extends Entity | ResolvedEntity>(entity: T, about: Pt, scale: number, rotation: number): T {
  const map = (p: Pt): Pt => rotatePoint(scalePoint(p, about, scale), about, rotation);
  switch (entity.type) {
    case 'line': {
      const a = map({ x: entity.x1, y: entity.y1 });
      const b = map({ x: entity.x2, y: entity.y2 });
      return { ...entity, x1: a.x, y1: a.y, x2: b.x, y2: b.y };
    }
    case 'circle':
      return { ...entity, cx: map({ x: entity.cx, y: entity.cy }).x, cy: map({ x: entity.cx, y: entity.cy }).y, r: round6(entity.r * scale) };
    case 'arc': {
      const c = map({ x: entity.cx, y: entity.cy });
      return { ...entity, cx: c.x, cy: c.y, r: round6(entity.r * scale), start: round6(entity.start + rotation), end: round6(entity.end + rotation) };
    }
    case 'pline':
      return { ...entity, points: entity.points.map(map) };
    case 'insert':
      return { ...entity, x: map({ x: entity.x, y: entity.y }).x, y: map({ x: entity.x, y: entity.y }).y, scale: round6(entity.scale * scale), rotation: round6(entity.rotation + rotation) };
    case 'hatch': {
      const c = map({ x: entity.seed_x, y: entity.seed_y });
      return { ...entity, seed_x: c.x, seed_y: c.y };
    }
    case 'dimension': {
      const c = map({ x: entity.text_x, y: entity.text_y });
      return { ...entity, text_x: c.x, text_y: c.y };
    }
  }
}

export function mirrorEntity<T extends Entity | ResolvedEntity>(entity: T, p1: Pt, p2: Pt): T {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return entity;
  const map = (p: Pt): Pt => {
    const t = ((p.x - p1.x) * dx + (p.y - p1.y) * dy) / len2;
    const fx = p1.x + dx * t;
    const fy = p1.y + dy * t;
    return round6Point({ x: 2 * fx - p.x, y: 2 * fy - p.y });
  };
  const mirrorAngle = (a: number): number => {
    const axis = (Math.atan2(dy, dx) * 180) / Math.PI;
    return round6(2 * axis - a);
  };
  switch (entity.type) {
    case 'line': {
      const a = map({ x: entity.x1, y: entity.y1 });
      const b = map({ x: entity.x2, y: entity.y2 });
      return { ...entity, x1: a.x, y1: a.y, x2: b.x, y2: b.y };
    }
    case 'circle':
      return { ...entity, cx: map({ x: entity.cx, y: entity.cy }).x, cy: map({ x: entity.cx, y: entity.cy }).y };
    case 'arc': {
      const c = map({ x: entity.cx, y: entity.cy });
      return { ...entity, cx: c.x, cy: c.y, start: mirrorAngle(entity.end), end: mirrorAngle(entity.start) };
    }
    case 'pline':
      return { ...entity, points: entity.points.map(map) };
    case 'insert':
      return { ...entity, x: map({ x: entity.x, y: entity.y }).x, y: map({ x: entity.x, y: entity.y }).y, rotation: mirrorAngle(entity.rotation) };
    case 'hatch':
      return { ...entity, seed_x: map({ x: entity.seed_x, y: entity.seed_y }).x, seed_y: map({ x: entity.seed_x, y: entity.seed_y }).y };
    case 'dimension':
      return { ...entity, text_x: map({ x: entity.text_x, y: entity.text_y }).x, text_y: map({ x: entity.text_x, y: entity.text_y }).y };
  }
}

export function lineAngle(x1: number, y1: number, x2: number, y2: number): number {
  return (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;
}

export function normaliseDeg(a: number): number {
  let v = a % 360;
  if (v < 0) v += 360;
  return round6(v);
}

export function angleDifference(a: number, b: number): number {
  let d = Math.abs(a - b) % 360;
  if (d > 180) d = 360 - d;
  return d;
}

export function offsetLine(x1: number, y1: number, x2: number, y2: number, d: number, side: Pt): EntityGeom & { type: 'line' } {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  if (len === 0) return { type: 'line', x1, y1, x2, y2 };
  const nx = -dy / len;
  const ny = dx / len;
  const sign = (side.x - x1) * nx + (side.y - y1) * ny >= 0 ? 1 : -1;
  const ox = nx * d * sign;
  const oy = ny * d * sign;
  return { type: 'line', x1: round6(x1 + ox), y1: round6(y1 + oy), x2: round6(x2 + ox), y2: round6(y2 + oy) };
}

export function lineIntersection(p1: Pt, p2: Pt, p3: Pt, p4: Pt): Pt | null {
  const d1x = p2.x - p1.x;
  const d1y = p2.y - p1.y;
  const d2x = p4.x - p3.x;
  const d2y = p4.y - p3.y;
  const denom = d1x * d2y - d1y * d2x;
  if (Math.abs(denom) < 1e-12) return null;
  const t = ((p3.x - p1.x) * d2y - (p3.y - p1.y) * d2x) / denom;
  const u = ((p3.x - p1.x) * d1y - (p3.y - p1.y) * d1x) / denom;
  if (t < -1e-9 || t > 1 + 1e-9 || u < -1e-9 || u > 1 + 1e-9) return null;
  return { x: round6(p1.x + d1x * t), y: round6(p1.y + d1y * t) };
}

export function rayLineIntersection(origin: Pt, dir: Pt, p1: Pt, p2: Pt): Pt | null {
  const denom = dir.x * (p2.y - p1.y) - dir.y * (p2.x - p1.x);
  if (Math.abs(denom) < 1e-12) return null;
  const t = ((p1.x - origin.x) * (p2.y - p1.y) - (p1.y - origin.y) * (p2.x - p1.x)) / denom;
  const u = ((p1.x - origin.x) * dir.y - (p1.y - origin.y) * dir.x) / denom;
  if (t < -1e-9 || u < -1e-9 || u > 1 + 1e-9) return null;
  return { x: round6(origin.x + dir.x * t), y: round6(origin.y + dir.y * t) };
}

export function pointOnSegment(p: Pt, a: Pt, b: Pt, tol = 1e-9): boolean {
  const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
  if (Math.abs(cross) > tol) return false;
  const dot = (p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y);
  if (dot < -tol) return false;
  const len2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
  if (dot > len2 + tol) return false;
  return true;
}

export function distanceToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
}

export function polylineSegments(entity: Entity | ResolvedEntity): Array<[Pt, Pt]> {
  if (entity.type === 'line') return [[{ x: entity.x1, y: entity.y1 }, { x: entity.x2, y: entity.y2 }]];
  if (entity.type !== 'pline' || entity.points.length < 2) return [];
  const segs: Array<[Pt, Pt]> = [];
  const last = entity.closed ? entity.points.length : entity.points.length - 1;
  for (let i = 0; i < last; i++) {
    segs.push([entity.points[i], entity.points[(i + 1) % entity.points.length]]);
  }
  return segs;
}

export function polylineNearest(entity: Entity, p: Pt): Pt | null {
  const segs = polylineSegments(entity);
  let best: Pt | null = null;
  let bestD = Infinity;
  for (const [a, b] of segs) {
    const d = distanceToSegment(p, a, b);
    if (d < bestD) {
      bestD = d;
      best = closestPointOnSegment(p, a, b);
    }
  }
  return best;
}

export function closestPointOnSegment(p: Pt, a: Pt, b: Pt): Pt {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return a;
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return { x: round6(a.x + dx * t), y: round6(a.y + dy * t) };
}

export function angleAt(entity: Entity, index: number): number {
  if (entity.type === 'line') return index === 0 ? lineAngle(entity.x2, entity.y2, entity.x1, entity.y1) : lineAngle(entity.x1, entity.y1, entity.x2, entity.y2);
  if (entity.type === 'arc') return index === 0 ? entity.end + 180 : entity.start;
  return 0;
}

export function nearlyEqualEntity(a: Entity, b: Entity): boolean {
  if (a.type !== b.type) return false;
  if (a.layer !== b.layer) return false;
  switch (a.type) {
    case 'line': {
      const other = b as Extract<Entity, { type: 'line' }>;
      return nearly(a.x1, other.x1) && nearly(a.y1, other.y1) && nearly(a.x2, other.x2) && nearly(a.y2, other.y2);
    }
    case 'circle': {
      const other = b as Extract<Entity, { type: 'circle' }>;
      return nearly(a.cx, other.cx) && nearly(a.cy, other.cy) && nearly(a.r, other.r);
    }
    case 'arc': {
      const other = b as Extract<Entity, { type: 'arc' }>;
      return nearly(a.cx, other.cx) && nearly(a.cy, other.cy) && nearly(a.r, other.r) && nearly(a.start, other.start) && nearly(a.end, other.end);
    }
    case 'pline': {
      const other = b as Extract<Entity, { type: 'pline' }>;
      if (a.points.length !== other.points.length || a.closed !== other.closed) return false;
      for (let i = 0; i < a.points.length; i++) {
        if (!nearly(a.points[i].x, other.points[i].x) || !nearly(a.points[i].y, other.points[i].y)) return false;
      }
      return true;
    }
    case 'insert': {
      const other = b as Extract<Entity, { type: 'insert' }>;
      return a.block === other.block && nearly(a.x, other.x) && nearly(a.y, other.y) && nearly(a.scale, other.scale) && nearly(a.rotation, other.rotation);
    }
    case 'hatch': {
      const other = b as Extract<Entity, { type: 'hatch' }>;
      return nearly(a.seed_x, other.seed_x) && nearly(a.seed_y, other.seed_y);
    }
    case 'dimension': {
      const other = b as Extract<Entity, { type: 'dimension' }>;
      return a.kind === other.kind && a.style === other.style && JSON.stringify(a.refs) === JSON.stringify(other.refs) && a.override === other.override && nearly(a.text_x, other.text_x) && nearly(a.text_y, other.text_y);
    }
  }
}

export function entityNumericValues(entity: Entity): number[] {
  switch (entity.type) {
    case 'line':
      return [entity.x1, entity.y1, entity.x2, entity.y2];
    case 'circle':
      return [entity.cx, entity.cy, entity.r];
    case 'arc':
      return [entity.cx, entity.cy, entity.r, entity.start, entity.end];
    case 'pline':
      return entity.points.flatMap((p) => [p.x, p.y]);
    case 'insert':
      return [entity.x, entity.y, entity.scale, entity.rotation];
    case 'hatch':
      return [entity.seed_x, entity.seed_y];
    case 'dimension':
      return [entity.text_x, entity.text_y];
  }
}

export function nonNumericFields(entity: Entity): string {
  switch (entity.type) {
    case 'insert':
      return `${entity.block}|${JSON.stringify(entity.attributes)}`;
    case 'dimension':
      return `${entity.kind}|${entity.style}|${JSON.stringify(entity.refs)}|${entity.override ?? ''}`;
    default:
      return '';
  }
}

export function angleOfPoint(p: Pt): number {
  return normaliseDeg((Math.atan2(p.y, p.x) * 180) / Math.PI);
}

export function arcBulgesOutward(cx: number, cy: number, start: number, end: number): boolean {
  const mid = ((start + end) / 2) * (Math.PI / 180);
  return Math.cos(mid) >= 0 || Math.sin(mid) >= 0;
}

export function nearlyPointEqual(a: Pt, b: Pt): boolean {
  return nearly(a.x, b.x) && nearly(a.y, b.y);
}

export function rayCircleFar(origin: Pt, dir: Pt, cx: number, cy: number, r: number): Pt | null {
  const fx = origin.x - cx;
  const fy = origin.y - cy;
  const a = dir.x * dir.x + dir.y * dir.y;
  const b = 2 * (fx * dir.x + fy * dir.y);
  const c = fx * fx + fy * fy - r * r;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return null;
  const sqrt = Math.sqrt(disc);
  const t1 = (-b - sqrt) / (2 * a);
  const t2 = (-b + sqrt) / (2 * a);
  let best: Pt | null = null;
  let bestT = Infinity;
  for (const t of [t1, t2]) {
    if (t > 1e-9 && t < bestT) {
      bestT = t;
      best = { x: round6(origin.x + dir.x * t), y: round6(origin.y + dir.y * t) };
    }
  }
  return best;
}

export function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

export function radToDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}

export function isZero(v: number): boolean {
  return nearlyZero(v);
}

export const SNAP_TOLERANCE = TOLERANCE;
