import { TOLERANCE, round6 } from './numbers.js';
import type { ArcEntity, CircleEntity, DrawingModel, Entity, LineEntity, PlineEntity } from './model.js';
import { findBlock } from './model.js';

export interface Vec {
  x: number;
  y: number;
}

export interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export type Prim =
  | { kind: 'seg'; a: Vec; b: Vec }
  | { kind: 'arc'; c: Vec; r: number; start: number; end: number; full: boolean };

export const vec = (x: number, y: number): Vec => ({ x, y });
export const add = (a: Vec, b: Vec): Vec => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y });
export const mul = (a: Vec, k: number): Vec => ({ x: a.x * k, y: a.y * k });
export const dot = (a: Vec, b: Vec): number => a.x * b.x + a.y * b.y;
export const cross = (a: Vec, b: Vec): number => a.x * b.y - a.y * b.x;
export const len = (a: Vec): number => Math.hypot(a.x, a.y);
export const dist = (a: Vec, b: Vec): number => Math.hypot(a.x - b.x, a.y - b.y);

export function norm(a: Vec): Vec {
  const l = len(a);
  return l === 0 ? { x: 0, y: 0 } : { x: a.x / l, y: a.y / l };
}

export const toRad = (deg: number): number => (deg * Math.PI) / 180;
export const toDeg = (rad: number): number => (rad * 180) / Math.PI;

export function normAngle(deg: number): number {
  let out = deg % 360;
  if (out < 0) out += 360;
  return out === 360 ? 0 : out;
}

export function angleOf(v: Vec): number {
  return normAngle(toDeg(Math.atan2(v.y, v.x)));
}

export function pointAt(centre: Vec, radius: number, angleDeg: number): Vec {
  const rad = toRad(angleDeg);
  return { x: centre.x + radius * Math.cos(rad), y: centre.y + radius * Math.sin(rad) };
}

export function rotatePoint(p: Vec, about: Vec, angleDeg: number): Vec {
  const rad = toRad(angleDeg);
  const d = sub(p, about);
  return {
    x: about.x + d.x * Math.cos(rad) - d.y * Math.sin(rad),
    y: about.y + d.x * Math.sin(rad) + d.y * Math.cos(rad),
  };
}

export function arcSweep(start: number, end: number): number {
  const sweep = normAngle(end - start);
  return sweep === 0 ? 360 : sweep;
}

export function arcContainsAngle(start: number, end: number, angle: number, full = false): boolean {
  if (full) return true;
  const sweep = arcSweep(start, end);
  const offset = normAngle(angle - start);
  const slack = 1e-7;
  return offset <= sweep + slack || offset >= 360 - slack;
}

export function entityPrims(entity: Entity): Prim[] {
  switch (entity.type) {
    case 'line':
      return [{ kind: 'seg', a: vec(entity.x1, entity.y1), b: vec(entity.x2, entity.y2) }];
    case 'circle':
      return [{ kind: 'arc', c: vec(entity.cx, entity.cy), r: entity.r, start: 0, end: 0, full: true }];
    case 'arc':
      return [
        { kind: 'arc', c: vec(entity.cx, entity.cy), r: entity.r, start: entity.start, end: entity.end, full: false },
      ];
    case 'pline': {
      const prims: Prim[] = [];
      const pts = entity.points;
      for (let i = 0; i + 1 < pts.length; i += 1) {
        prims.push({ kind: 'seg', a: vec(pts[i][0], pts[i][1]), b: vec(pts[i + 1][0], pts[i + 1][1]) });
      }
      if (entity.closed && pts.length > 2) {
        const last = pts[pts.length - 1];
        prims.push({ kind: 'seg', a: vec(last[0], last[1]), b: vec(pts[0][0], pts[0][1]) });
      }
      return prims;
    }
    default:
      return [];
  }
}

export function primIntersections(p: Prim, q: Prim): Vec[] {
  if (p.kind === 'seg' && q.kind === 'seg') return segSegIntersections(p.a, p.b, q.a, q.b);
  if (p.kind === 'seg' && q.kind === 'arc') return segArcIntersections(p.a, p.b, q);
  if (p.kind === 'arc' && q.kind === 'seg') return segArcIntersections(q.a, q.b, p);
  if (p.kind === 'arc' && q.kind === 'arc') return arcArcIntersections(p, q);
  return [];
}

export function segSegIntersections(a1: Vec, a2: Vec, b1: Vec, b2: Vec): Vec[] {
  const r = sub(a2, a1);
  const s = sub(b2, b1);
  const denom = cross(r, s);
  if (Math.abs(denom) < 1e-12) return [];
  const t = cross(sub(b1, a1), s) / denom;
  const u = cross(sub(b1, a1), r) / denom;
  const slackT = len(r) === 0 ? 0 : TOLERANCE / len(r);
  const slackU = len(s) === 0 ? 0 : TOLERANCE / len(s);
  if (t < -slackT || t > 1 + slackT || u < -slackU || u > 1 + slackU) return [];
  return [add(a1, mul(r, t))];
}

export function segArcIntersections(a: Vec, b: Vec, arc: { c: Vec; r: number; start: number; end: number; full: boolean }): Vec[] {
  const d = sub(b, a);
  const f = sub(a, arc.c);
  const aa = dot(d, d);
  if (aa < 1e-18) return [];
  const bb = 2 * dot(f, d);
  const cc = dot(f, f) - arc.r * arc.r;
  const disc = bb * bb - 4 * aa * cc;
  if (disc < 0) return [];
  const sqrt = Math.sqrt(Math.max(disc, 0));
  const slack = TOLERANCE / Math.sqrt(aa);
  const out: Vec[] = [];
  for (const t of [(-bb - sqrt) / (2 * aa), (-bb + sqrt) / (2 * aa)]) {
    if (t < -slack || t > 1 + slack) continue;
    const point = add(a, mul(d, t));
    if (arcContainsAngle(arc.start, arc.end, angleOf(sub(point, arc.c)), arc.full)) out.push(point);
  }
  return dedupe(out);
}

export function arcArcIntersections(
  p: { c: Vec; r: number; start: number; end: number; full: boolean },
  q: { c: Vec; r: number; start: number; end: number; full: boolean },
): Vec[] {
  const between = dist(p.c, q.c);
  if (between < 1e-12) return [];
  if (between > p.r + q.r + TOLERANCE || between < Math.abs(p.r - q.r) - TOLERANCE) return [];
  const a = (p.r * p.r - q.r * q.r + between * between) / (2 * between);
  const hSquared = p.r * p.r - a * a;
  const h = Math.sqrt(Math.max(hSquared, 0));
  const base = add(p.c, mul(norm(sub(q.c, p.c)), a));
  const dir = norm(sub(q.c, p.c));
  const perp = vec(-dir.y, dir.x);
  const out: Vec[] = [];
  for (const point of [add(base, mul(perp, h)), sub(base, mul(perp, h))]) {
    if (
      arcContainsAngle(p.start, p.end, angleOf(sub(point, p.c)), p.full) &&
      arcContainsAngle(q.start, q.end, angleOf(sub(point, q.c)), q.full)
    ) {
      out.push(point);
    }
  }
  return dedupe(out);
}

export function dedupe(points: Vec[]): Vec[] {
  const out: Vec[] = [];
  for (const point of points) {
    if (!out.some((other) => dist(other, point) <= TOLERANCE)) out.push(point);
  }
  return out;
}

export function entityIntersections(a: Entity, b: Entity): Vec[] {
  const out: Vec[] = [];
  for (const p of entityPrims(a)) {
    for (const q of entityPrims(b)) {
      out.push(...primIntersections(p, q));
    }
  }
  return dedupe(out);
}

export function closestOnPrim(prim: Prim, point: Vec): Vec {
  if (prim.kind === 'seg') {
    const d = sub(prim.b, prim.a);
    const l2 = dot(d, d);
    if (l2 < 1e-18) return prim.a;
    const t = Math.min(1, Math.max(0, dot(sub(point, prim.a), d) / l2));
    return add(prim.a, mul(d, t));
  }
  const angle = angleOf(sub(point, prim.c));
  if (arcContainsAngle(prim.start, prim.end, angle, prim.full)) return pointAt(prim.c, prim.r, angle);
  const first = pointAt(prim.c, prim.r, prim.start);
  const second = pointAt(prim.c, prim.r, prim.end);
  return dist(point, first) <= dist(point, second) ? first : second;
}

export function closestOnEntity(entity: Entity, point: Vec): Vec | null {
  const prims = entityPrims(entity);
  if (prims.length === 0) return null;
  let best: Vec | null = null;
  let bestDist = Infinity;
  for (const prim of prims) {
    const candidate = closestOnPrim(prim, point);
    const d = dist(candidate, point);
    if (d < bestDist) {
      bestDist = d;
      best = candidate;
    }
  }
  return best;
}

export function distanceToEntity(entity: Entity, point: Vec): number {
  const closest = closestOnEntity(entity, point);
  return closest ? dist(closest, point) : Infinity;
}

export function perpFoot(a: Vec, b: Vec, from: Vec): Vec | null {
  const d = sub(b, a);
  const l2 = dot(d, d);
  if (l2 < 1e-18) return null;
  const t = dot(sub(from, a), d) / l2;
  if (t < 0 || t > 1) return null;
  return add(a, mul(d, t));
}

export function tangentPoints(centre: Vec, radius: number, from: Vec): Vec[] {
  const d = dist(from, centre);
  if (d <= radius + 1e-9) return [];
  const base = angleOf(sub(from, centre));
  const offset = toDeg(Math.acos(radius / d));
  return [pointAt(centre, radius, base + offset), pointAt(centre, radius, base - offset)];
}

export function entityPoints(entity: Entity): { kind: 'endpoint' | 'midpoint' | 'centre'; point: Vec }[] {
  const out: { kind: 'endpoint' | 'midpoint' | 'centre'; point: Vec }[] = [];
  switch (entity.type) {
    case 'line':
      out.push({ kind: 'endpoint', point: vec(entity.x1, entity.y1) });
      out.push({ kind: 'endpoint', point: vec(entity.x2, entity.y2) });
      out.push({ kind: 'midpoint', point: vec((entity.x1 + entity.x2) / 2, (entity.y1 + entity.y2) / 2) });
      break;
    case 'circle':
      out.push({ kind: 'centre', point: vec(entity.cx, entity.cy) });
      break;
    case 'arc': {
      const centre = vec(entity.cx, entity.cy);
      out.push({ kind: 'endpoint', point: pointAt(centre, entity.r, entity.start) });
      out.push({ kind: 'endpoint', point: pointAt(centre, entity.r, entity.end) });
      out.push({ kind: 'midpoint', point: pointAt(centre, entity.r, entity.start + arcSweep(entity.start, entity.end) / 2) });
      out.push({ kind: 'centre', point: centre });
      break;
    }
    case 'pline': {
      for (const [x, y] of entity.points) out.push({ kind: 'endpoint', point: vec(x, y) });
      for (const prim of entityPrims(entity)) {
        if (prim.kind === 'seg') {
          out.push({ kind: 'midpoint', point: vec((prim.a.x + prim.b.x) / 2, (prim.a.y + prim.b.y) / 2) });
        }
      }
      break;
    }
    default:
      break;
  }
  return out;
}

/** The entity's start, end and centre points, for dimension links. */
export function namedPoints(entity: Entity): { point: 'start' | 'end' | 'centre'; at: Vec }[] {
  switch (entity.type) {
    case 'line':
      return [
        { point: 'start', at: vec(entity.x1, entity.y1) },
        { point: 'end', at: vec(entity.x2, entity.y2) },
        { point: 'centre', at: vec((entity.x1 + entity.x2) / 2, (entity.y1 + entity.y2) / 2) },
      ];
    case 'circle':
      return [{ point: 'centre', at: vec(entity.cx, entity.cy) }];
    case 'arc': {
      const centre = vec(entity.cx, entity.cy);
      return [
        { point: 'start', at: pointAt(centre, entity.r, entity.start) },
        { point: 'end', at: pointAt(centre, entity.r, entity.end) },
        { point: 'centre', at: centre },
      ];
    }
    case 'pline': {
      const pts = entity.points;
      if (pts.length === 0) return [];
      return [
        { point: 'start', at: vec(pts[0][0], pts[0][1]) },
        { point: 'end', at: vec(pts[pts.length - 1][0], pts[pts.length - 1][1]) },
      ];
    }
    case 'insert':
      return [{ point: 'start', at: vec(entity.x, entity.y) }];
    default:
      return [];
  }
}

export function entityLength(entity: Entity): number | null {
  switch (entity.type) {
    case 'line':
      return Math.hypot(entity.x2 - entity.x1, entity.y2 - entity.y1);
    case 'arc':
      return entity.r * toRad(arcSweep(entity.start, entity.end));
    case 'circle':
      return 2 * Math.PI * entity.r;
    case 'pline': {
      let total = 0;
      for (const prim of entityPrims(entity)) {
        if (prim.kind === 'seg') total += dist(prim.a, prim.b);
      }
      return total;
    }
    default:
      return null;
  }
}

export function polygonArea(points: Vec[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
}

export function entityArea(entity: Entity): number | null {
  switch (entity.type) {
    case 'circle':
      return Math.PI * entity.r * entity.r;
    case 'pline':
      if (!entity.closed) return null;
      return Math.abs(polygonArea(entity.points.map(([x, y]) => vec(x, y))));
    case 'hatch':
      return entity.area;
    default:
      return null;
  }
}

export function boxOf(points: Vec[]): Box {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
}

export function arcBox(centre: Vec, radius: number, start: number, end: number, full: boolean): Box {
  const points: Vec[] = full
    ? [pointAt(centre, radius, 0), pointAt(centre, radius, 90), pointAt(centre, radius, 180), pointAt(centre, radius, 270)]
    : [pointAt(centre, radius, start), pointAt(centre, radius, end)];
  if (!full) {
    for (const angle of [0, 90, 180, 270]) {
      if (arcContainsAngle(start, end, angle, false)) points.push(pointAt(centre, radius, angle));
    }
  }
  return boxOf(points);
}

export function entityBox(model: DrawingModel, entity: Entity): Box {
  switch (entity.type) {
    case 'line':
      return boxOf([vec(entity.x1, entity.y1), vec(entity.x2, entity.y2)]);
    case 'circle':
      return arcBox(vec(entity.cx, entity.cy), entity.r, 0, 0, true);
    case 'arc':
      return arcBox(vec(entity.cx, entity.cy), entity.r, entity.start, entity.end, false);
    case 'pline':
      return boxOf(entity.points.map(([x, y]) => vec(x, y)));
    case 'hatch': {
      const points: Vec[] = [];
      for (const handle of [...entity.boundary, ...entity.islands]) {
        const edge = model.entities.find((candidate) => candidate.handle === handle);
        if (!edge) continue;
        const box = entityBox(model, edge);
        points.push(vec(box.minX, box.minY), vec(box.maxX, box.maxY));
      }
      if (points.length === 0) return boxOf([vec(entity.seed_x, entity.seed_y)]);
      return boxOf(points);
    }
    case 'dimension': {
      const points = entity.points.map(([x, y]) => vec(x, y));
      points.push(vec(entity.text_x, entity.text_y));
      return boxOf(points);
    }
    case 'insert': {
      const block = findBlock(model, entity.block);
      if (!block) return boxOf([vec(entity.x, entity.y)]);
      const drawn = blockDrawnEntities(model, entity, block);
      if (drawn.length === 0) return boxOf([vec(entity.x, entity.y)]);
      const boxes = drawn.map((child) => entityBox(model, child));
      return {
        minX: Math.min(...boxes.map((b) => b.minX)),
        minY: Math.min(...boxes.map((b) => b.minY)),
        maxX: Math.max(...boxes.map((b) => b.maxX)),
        maxY: Math.max(...boxes.map((b) => b.maxY)),
      };
    }
  }
}

export function boxesMeet(a: Box, b: Box): boolean {
  return a.minX <= b.maxX + TOLERANCE && b.minX <= a.maxX + TOLERANCE && a.minY <= b.maxY + TOLERANCE && b.minY <= a.maxY + TOLERANCE;
}

export function boxContains(outer: Box, inner: Box): boolean {
  return (
    outer.minX <= inner.minX + TOLERANCE &&
    outer.minY <= inner.minY + TOLERANCE &&
    outer.maxX + TOLERANCE >= inner.maxX &&
    outer.maxY + TOLERANCE >= inner.maxY
  );
}

export function boxCentre(box: Box): Vec {
  return vec((box.minX + box.maxX) / 2, (box.minY + box.maxY) / 2);
}

/** The block insert transform: insert point + rotate(rotation, scale x (p - base)). */
export function blockTransform(insert: { x: number; y: number; scale: number; rotation: number }, base: [number, number], point: Vec): Vec {
  const scaled = mul(sub(point, vec(base[0], base[1])), insert.scale);
  const rotated = rotatePoint(add(scaled, vec(0, 0)), vec(0, 0), insert.rotation);
  return add(vec(insert.x, insert.y), rotated);
}

export function transformEntity(
  entity: Entity,
  insert: { x: number; y: number; scale: number; rotation: number },
  base: [number, number],
): Entity {
  const map = (p: Vec): Vec => blockTransform(insert, base, p);
  const clone = structuredClone(entity);
  switch (clone.type) {
    case 'line': {
      const a = map(vec(clone.x1, clone.y1));
      const b = map(vec(clone.x2, clone.y2));
      clone.x1 = round6(a.x);
      clone.y1 = round6(a.y);
      clone.x2 = round6(b.x);
      clone.y2 = round6(b.y);
      break;
    }
    case 'circle': {
      const c = map(vec(clone.cx, clone.cy));
      clone.cx = round6(c.x);
      clone.cy = round6(c.y);
      clone.r = round6(clone.r * insert.scale);
      break;
    }
    case 'arc': {
      const c = map(vec(clone.cx, clone.cy));
      clone.cx = round6(c.x);
      clone.cy = round6(c.y);
      clone.r = round6(clone.r * insert.scale);
      clone.start = round6(normAngle(clone.start + insert.rotation));
      clone.end = round6(normAngle(clone.end + insert.rotation));
      break;
    }
    case 'pline':
      clone.points = clone.points.map(([x, y]) => {
        const p = map(vec(x, y));
        return [round6(p.x), round6(p.y)] as [number, number];
      });
      break;
    case 'insert': {
      const p = map(vec(clone.x, clone.y));
      clone.x = round6(p.x);
      clone.y = round6(p.y);
      clone.scale = round6(clone.scale * insert.scale);
      clone.rotation = round6(normAngle(clone.rotation + insert.rotation));
      break;
    }
    case 'dimension': {
      clone.points = clone.points.map(([x, y]) => {
        const p = map(vec(x, y));
        return [round6(p.x), round6(p.y)] as [number, number];
      });
      const text = map(vec(clone.text_x, clone.text_y));
      clone.text_x = round6(text.x);
      clone.text_y = round6(text.y);
      break;
    }
    case 'hatch': {
      const seed = map(vec(clone.seed_x, clone.seed_y));
      clone.seed_x = round6(seed.x);
      clone.seed_y = round6(seed.y);
      break;
    }
  }
  return clone;
}

/** The entities of a block insert at their drawn positions, nested blocks included. */
export function blockDrawnEntities(
  model: DrawingModel,
  insert: { x: number; y: number; scale: number; rotation: number; block: string; layer: string },
  block = findBlock(model, insert.block),
): Entity[] {
  if (!block) return [];
  const out: Entity[] = [];
  for (const child of block.entities) {
    const drawn = transformEntity(child, insert, block.base);
    if (drawn.type === 'insert') {
      out.push(...blockDrawnEntities(model, drawn));
    } else {
      out.push(drawn);
    }
  }
  return out;
}

export function firstPointOf(entity: Entity): Vec {
  switch (entity.type) {
    case 'line':
      return vec(entity.x1, entity.y1);
    case 'circle':
      return vec(entity.cx, entity.cy);
    case 'arc':
      return pointAt(vec(entity.cx, entity.cy), entity.r, entity.start);
    case 'pline':
      return entity.points.length ? vec(entity.points[0][0], entity.points[0][1]) : vec(0, 0);
    case 'insert':
      return vec(entity.x, entity.y);
    case 'hatch':
      return vec(entity.seed_x, entity.seed_y);
    case 'dimension':
      return entity.points.length ? vec(entity.points[0][0], entity.points[0][1]) : vec(entity.text_x, entity.text_y);
  }
}

export function midpointOf(entity: Entity): Vec {
  switch (entity.type) {
    case 'line':
      return vec((entity.x1 + entity.x2) / 2, (entity.y1 + entity.y2) / 2);
    case 'circle':
      return vec(entity.cx, entity.cy);
    case 'arc':
      return pointAt(vec(entity.cx, entity.cy), entity.r, entity.start + arcSweep(entity.start, entity.end) / 2);
    case 'pline': {
      const prims = entityPrims(entity);
      if (prims.length === 0) return vec(0, 0);
      const prim = prims[Math.floor(prims.length / 2)];
      return prim.kind === 'seg' ? vec((prim.a.x + prim.b.x) / 2, (prim.a.y + prim.b.y) / 2) : prim.c;
    }
    case 'insert':
      return vec(entity.x, entity.y);
    case 'hatch':
      return vec(entity.seed_x, entity.seed_y);
    case 'dimension':
      return vec(entity.text_x, entity.text_y);
  }
}

export function moveEntity(entity: Entity, dx: number, dy: number): void {
  switch (entity.type) {
    case 'line':
      entity.x1 = round6(entity.x1 + dx);
      entity.y1 = round6(entity.y1 + dy);
      entity.x2 = round6(entity.x2 + dx);
      entity.y2 = round6(entity.y2 + dy);
      break;
    case 'circle':
    case 'arc':
      entity.cx = round6(entity.cx + dx);
      entity.cy = round6(entity.cy + dy);
      break;
    case 'pline':
      entity.points = entity.points.map(([x, y]) => [round6(x + dx), round6(y + dy)] as [number, number]);
      break;
    case 'insert':
      entity.x = round6(entity.x + dx);
      entity.y = round6(entity.y + dy);
      break;
    case 'hatch':
      entity.seed_x = round6(entity.seed_x + dx);
      entity.seed_y = round6(entity.seed_y + dy);
      break;
    case 'dimension':
      entity.points = entity.points.map(([x, y]) => [round6(x + dx), round6(y + dy)] as [number, number]);
      entity.text_x = round6(entity.text_x + dx);
      entity.text_y = round6(entity.text_y + dy);
      break;
  }
}

export function rotateEntity(entity: Entity, about: Vec, angleDeg: number): void {
  const spin = (x: number, y: number): [number, number] => {
    const p = rotatePoint(vec(x, y), about, angleDeg);
    return [round6(p.x), round6(p.y)];
  };
  switch (entity.type) {
    case 'line': {
      [entity.x1, entity.y1] = spin(entity.x1, entity.y1);
      [entity.x2, entity.y2] = spin(entity.x2, entity.y2);
      break;
    }
    case 'circle': {
      [entity.cx, entity.cy] = spin(entity.cx, entity.cy);
      break;
    }
    case 'arc': {
      [entity.cx, entity.cy] = spin(entity.cx, entity.cy);
      entity.start = round6(normAngle(entity.start + angleDeg));
      entity.end = round6(normAngle(entity.end + angleDeg));
      break;
    }
    case 'pline':
      entity.points = entity.points.map(([x, y]) => spin(x, y));
      break;
    case 'insert': {
      [entity.x, entity.y] = spin(entity.x, entity.y);
      entity.rotation = round6(normAngle(entity.rotation + angleDeg));
      break;
    }
    case 'hatch': {
      [entity.seed_x, entity.seed_y] = spin(entity.seed_x, entity.seed_y);
      break;
    }
    case 'dimension': {
      entity.points = entity.points.map(([x, y]) => spin(x, y));
      [entity.text_x, entity.text_y] = spin(entity.text_x, entity.text_y);
      break;
    }
  }
}

export function scaleEntity(entity: Entity, about: Vec, factor: number): void {
  const grow = (x: number, y: number): [number, number] => [
    round6(about.x + (x - about.x) * factor),
    round6(about.y + (y - about.y) * factor),
  ];
  switch (entity.type) {
    case 'line': {
      [entity.x1, entity.y1] = grow(entity.x1, entity.y1);
      [entity.x2, entity.y2] = grow(entity.x2, entity.y2);
      break;
    }
    case 'circle': {
      [entity.cx, entity.cy] = grow(entity.cx, entity.cy);
      entity.r = round6(entity.r * factor);
      break;
    }
    case 'arc': {
      [entity.cx, entity.cy] = grow(entity.cx, entity.cy);
      entity.r = round6(entity.r * factor);
      break;
    }
    case 'pline':
      entity.points = entity.points.map(([x, y]) => grow(x, y));
      break;
    case 'insert': {
      [entity.x, entity.y] = grow(entity.x, entity.y);
      entity.scale = round6(entity.scale * factor);
      break;
    }
    case 'hatch': {
      [entity.seed_x, entity.seed_y] = grow(entity.seed_x, entity.seed_y);
      break;
    }
    case 'dimension': {
      entity.points = entity.points.map(([x, y]) => grow(x, y));
      [entity.text_x, entity.text_y] = grow(entity.text_x, entity.text_y);
      break;
    }
  }
}

export function mirrorPoint(p: Vec, a: Vec, b: Vec): Vec {
  const d = norm(sub(b, a));
  const t = dot(sub(p, a), d);
  const foot = add(a, mul(d, t));
  return add(foot, sub(foot, p));
}

export function mirrorEntity(entity: Entity, a: Vec, b: Vec): void {
  const axisAngle = angleOf(sub(b, a));
  const flip = (x: number, y: number): [number, number] => {
    const p = mirrorPoint(vec(x, y), a, b);
    return [round6(p.x), round6(p.y)];
  };
  switch (entity.type) {
    case 'line': {
      [entity.x1, entity.y1] = flip(entity.x1, entity.y1);
      [entity.x2, entity.y2] = flip(entity.x2, entity.y2);
      break;
    }
    case 'circle': {
      [entity.cx, entity.cy] = flip(entity.cx, entity.cy);
      break;
    }
    case 'arc': {
      [entity.cx, entity.cy] = flip(entity.cx, entity.cy);
      const start = normAngle(2 * axisAngle - entity.end);
      const end = normAngle(2 * axisAngle - entity.start);
      entity.start = round6(start);
      entity.end = round6(end);
      break;
    }
    case 'pline':
      entity.points = entity.points.map(([x, y]) => flip(x, y));
      break;
    case 'insert': {
      [entity.x, entity.y] = flip(entity.x, entity.y);
      entity.rotation = round6(normAngle(2 * axisAngle - entity.rotation));
      break;
    }
    case 'hatch': {
      [entity.seed_x, entity.seed_y] = flip(entity.seed_x, entity.seed_y);
      break;
    }
    case 'dimension': {
      entity.points = entity.points.map(([x, y]) => flip(x, y));
      [entity.text_x, entity.text_y] = flip(entity.text_x, entity.text_y);
      break;
    }
  }
}

export function lineOf(entity: Entity): { a: Vec; b: Vec } | null {
  if (entity.type !== 'line') return null;
  return { a: vec(entity.x1, entity.y1), b: vec(entity.x2, entity.y2) };
}

/** The crossing of two infinite lines, or null when they are parallel. */
export function infiniteIntersection(a1: Vec, a2: Vec, b1: Vec, b2: Vec): Vec | null {
  const r = sub(a2, a1);
  const s = sub(b2, b1);
  const denom = cross(r, s);
  if (Math.abs(denom) < 1e-9) return null;
  const t = cross(sub(b1, a1), s) / denom;
  return add(a1, mul(r, t));
}

export function angleBetween(u: Vec, v: Vec): number {
  const cosine = dot(norm(u), norm(v));
  return toDeg(Math.acos(Math.min(1, Math.max(-1, cosine))));
}

export function modelBox(model: DrawingModel, entities: Entity[]): Box | null {
  const boxes = entities.map((entity) => entityBox(model, entity));
  if (boxes.length === 0) return null;
  return {
    minX: Math.min(...boxes.map((b) => b.minX)),
    minY: Math.min(...boxes.map((b) => b.minY)),
    maxX: Math.max(...boxes.map((b) => b.maxX)),
    maxY: Math.max(...boxes.map((b) => b.maxY)),
  };
}

export function isLine(entity: Entity | undefined): entity is LineEntity {
  return !!entity && entity.type === 'line';
}

export function isCircle(entity: Entity | undefined): entity is CircleEntity {
  return !!entity && entity.type === 'circle';
}

export function isArc(entity: Entity | undefined): entity is ArcEntity {
  return !!entity && entity.type === 'arc';
}

export function isPline(entity: Entity | undefined): entity is PlineEntity {
  return !!entity && entity.type === 'pline';
}
