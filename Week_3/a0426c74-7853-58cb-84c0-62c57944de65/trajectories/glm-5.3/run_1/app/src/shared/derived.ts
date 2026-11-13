import {
  arcSegmentArea,
  circleArea,
  closedPolylineArea,
  type Entity,
  lineAngle,
  type Pt,
  pointInPolygon,
  polygonArea,
  nearlyPointEqual,
} from './geometry.js';
import { round6, nearly, nearlyZero, roundTo } from './num.js';

const nearlyPoint = nearlyPointEqual;
import type { ConstraintKind, DimStyleRecord, DrawingModel, LayerRecord } from './model.js';

// ---------------------------------------------------------------------------
// Derived values: dimensions, hatch areas, constraints, compare. Pure and
// shared by browser and server, so every screen and the API agree.
// ---------------------------------------------------------------------------

export interface ResolvedRef {
  handle: string;
  point: Pt | null;
}

export function resolveDimensionRefs(model: Pick<DrawingModel, 'entities'>, refs: Array<{ handle: string; point: 'start' | 'end' | 'centre' }>): Array<ResolvedRef> {
  return refs.map((ref) => {
    const entity = model.entities[ref.handle];
    if (!entity) return { handle: ref.handle, point: null };
    let pt: Pt | null = null;
    if (entity.type === 'line') {
      pt = ref.point === 'end' ? { x: entity.x2, y: entity.y2 } : { x: entity.x1, y: entity.y1 };
    } else if (entity.type === 'circle' || entity.type === 'arc') {
      if (ref.point === 'centre') pt = { x: entity.cx, y: entity.cy };
    } else if (entity.type === 'pline' && entity.points.length) {
      pt = ref.point === 'end' ? entity.points[entity.points.length - 1] : entity.points[0];
    }
    return { handle: ref.handle, point: pt };
  });
}

export function dimensionAssociative(model: Pick<DrawingModel, 'entities'>, refs: Array<{ handle: string; point: 'start' | 'end' | 'centre' }>): boolean {
  return refs.every((ref) => Boolean(model.entities[ref.handle]));
}

export function dimensionValue(
  model: Pick<DrawingModel, 'entities'>,
  kind: 'linear' | 'aligned' | 'angular' | 'radial',
  refs: Array<{ handle: string; point: 'start' | 'end' | 'centre' }>,
): number | null {
  const resolved = resolveDimensionRefs(model, refs);
  const pts = resolved.map((r) => r.point).filter((p): p is Pt => p !== null);
  if (kind === 'radial') {
    const ref = refs[0];
    const entity = model.entities[ref?.handle ?? ''];
    if (entity && (entity.type === 'circle' || entity.type === 'arc')) return entity.r;
    return null;
  }
  if (kind === 'angular') {
    const a = model.entities[refs[0]?.handle ?? ''];
    const b = model.entities[refs[1]?.handle ?? ''];
    if (!a || !b || a.type !== 'line' || b.type !== 'line') return null;
    let diff = Math.abs(lineAngle(a.x1, a.y1, a.x2, a.y2) - lineAngle(b.x1, b.y1, b.x2, b.y2)) % 360;
    if (diff > 180) diff = 360 - diff;
    return roundTo(diff, 6);
  }
  if (pts.length < 2) return null;
  if (kind === 'aligned') {
    return roundTo(Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y), 6);
  }
  const dx = Math.abs(pts[1].x - pts[0].x);
  const dy = Math.abs(pts[1].y - pts[0].y);
  return roundTo(dx >= dy ? dx : dy, 6);
}

export function dimensionScaledValue(
  model: Pick<DrawingModel, 'entities' | 'dim_styles'>,
  entity: Extract<Entity, { type: 'dimension' }>,
): { value: string; raw: number | null; style: DimStyleRecord | undefined } {
  const style = model.dim_styles[entity.style] ?? model.dim_styles.Standard;
  const raw = dimensionValue(model, entity.kind, entity.refs);
  if (raw === null || !style) return { value: '', raw: null, style };
  const scaled = raw * style.scale;
  return { value: scaled.toFixed(style.precision), raw, style };
}

export function dimensionText(model: Pick<DrawingModel, 'entities' | 'dim_styles'>, entity: Extract<Entity, { type: 'dimension' }>): string {
  const { value, style } = dimensionScaledValue(model, entity);
  const base = `${style?.prefix ?? ''}${value}${style?.suffix ?? ''}`;
  if (entity.override === null || entity.override === undefined) return base;
  return entity.override.replace('<>', base);
}

// ---------------------------------------------------------------------------
// Hatch boundary search and area
// ---------------------------------------------------------------------------

export interface HatchBoundary {
  handles: string[];
  outer: Pt[];
  islands: Array<{ handles: string[]; polygon: Pt[] }>;
  area: number;
}

type LoopEntity = { handle: string; entity: Entity };

function polylineLoop(entity: Entity): Pt[] | null {
  if (entity.type === 'pline' && entity.closed) return entity.points;
  return null;
}

function circleLoop(entity: Entity): Pt[] | null {
  if (entity.type === 'circle') {
    const pts: Pt[] = [];
    for (let a = 0; a < 360; a += 10) {
      pts.push({ x: round6(entity.cx + entity.r * Math.cos((a * Math.PI) / 180)), y: round6(entity.cy + entity.r * Math.sin((a * Math.PI) / 180)) });
    }
    return pts;
  }
  return null;
}

function arcPoints(entity: Entity): { start: Pt; end: Pt; cx: number; cy: number; r: number; startDeg: number; endDeg: number } | null {
  if (entity.type !== 'arc') return null;
  const rad = (d: number) => (d * Math.PI) / 180;
  return {
    start: { x: entity.cx + entity.r * Math.cos(rad(entity.start)), y: entity.cy + entity.r * Math.sin(rad(entity.start)) },
    end: { x: entity.cx + entity.r * Math.cos(rad(entity.end)), y: entity.cy + entity.r * Math.sin(rad(entity.end)) },
    cx: entity.cx,
    cy: entity.cy,
    r: entity.r,
    startDeg: entity.start,
    endDeg: entity.end,
  };
}

function arcPolygon(entity: Extract<Entity, { type: 'arc' }>): Pt[] {
  const pts: Pt[] = [];
  const span = entity.end - entity.start;
  const steps = Math.max(6, Math.ceil(span / 6));
  for (let i = 0; i <= steps; i++) {
    const a = entity.start + (span * i) / steps;
    pts.push({ x: round6(entity.cx + entity.r * Math.cos((a * Math.PI) / 180)), y: round6(entity.cy + entity.r * Math.sin((a * Math.PI) / 180)) });
  }
  return pts;
}

function loopPolygon(parts: LoopEntity[]): Pt[] | null {
  if (parts.length === 1) {
    const only = parts[0].entity;
    const asPl = polylineLoop(only);
    if (asPl) return asPl;
    return circleLoop(only);
  }
  const endsOf = (part: LoopEntity): Array<[Pt, Pt]> => {
    const e = part.entity;
    if (e.type === 'line') return [[{ x: e.x1, y: e.y1 }, { x: e.x2, y: e.y2 }]];
    const ap = arcPoints(e)!;
    return [[ap.start, ap.end]];
  };
  const remaining = parts.slice();
  let pair = endsOf(remaining.shift()!)[0];
  let startPt = pair[0];
  let cursor = pair[1];
  const forward: Pt[] = [startPt, cursor];
  const outline: Array<{ from: Pt; to: Pt; part: LoopEntity }> = [{ from: startPt, to: cursor, part: parts[0] }];
  while (remaining.length) {
    const hit = remaining.findIndex((candidate) => {
      const ends = endsOf(candidate);
      return ends.some((end) => nearlyPoint(end[0], cursor) || nearlyPoint(end[1], cursor));
    });
    if (hit < 0) return null;
    const candidate = remaining.splice(hit, 1)[0];
    const ends = endsOf(candidate);
    const matching = ends.find((end) => nearlyPoint(end[0], cursor) || nearlyPoint(end[1], cursor))!;
    const from = matching[0];
    const to = matching[1];
    const next = nearlyPoint(from, cursor) ? to : from;
    outline.push({ from: cursor, to: next, part: candidate });
    cursor = next;
    forward.push(cursor);
    void startPt;
  }
  if (!nearlyPoint(startPt, cursor)) return null;
  const chain: Pt[] = [];
  for (const step of outline) {
    if (step.part.entity.type === 'line') {
      chain.push(step.from, step.to);
    } else {
      const e = step.part.entity as Extract<Entity, { type: 'arc' }>;
      const ap = arcPoints(e)!;
      const beginsAtFrom = nearlyPoint(ap.start, step.from);
      if (beginsAtFrom) {
        for (const p of arcPolygon(e)) chain.push(p);
      } else {
        for (const p of arcPolygon(e).reverse()) chain.push(p);
      }
    }
  }
  return chain;
}


function loopArea(parts: LoopEntity[]): number | null {
  const poly = loopPolygon(parts);
  if (!poly) return null;
  let area = polygonArea(poly);
  for (const part of parts) {
    const e = part.entity;
    if (e.type === 'arc') {
      const theta = ((e.end - e.start) * Math.PI) / 180;
      const mid = ((e.start + e.end) / 2) * (Math.PI / 180);
      const outward = Math.cos(mid) >= 0 || Math.sin(mid) >= 0;
      const seg = arcSegmentArea(e.r, theta);
      area += outward ? seg : -seg;
    }
  }
  return round6(Math.max(area, 0));
}

function chainLoops(entities: LoopEntity[], ignoreFrozen: boolean, layers: Record<string, LayerRecord>): LoopEntity[][] {
  const loops: LoopEntity[][] = [];
  const openEntities = entities.filter((e) => e.entity.type === 'line' || e.entity.type === 'arc');
  const used = new Set<string>();
  const endpointsOf = (e: Entity): Array<[Pt, Pt]> => {
    if (e.type === 'line') return [[{ x: e.x1, y: e.y1 }, { x: e.x2, y: e.y2 }]];
    if (e.type === 'arc') {
      const ap = arcPoints(e)!;
      return [[ap.start, ap.end]];
    }
    return [];
  };
  const samePoint = (a: Pt, b: Pt) => nearly(a.x, b.x) && nearly(a.y, b.y);
  for (const start of openEntities) {
    if (used.has(start.handle)) continue;
    const chain: LoopEntity[] = [start];
    used.add(start.handle);
    const ends = endpointsOf(start.entity);
    let frontier: Array<{ pt: Pt; from: string }> = [
      { pt: ends[0][0], from: start.handle },
      { pt: ends[0][1], from: start.handle },
    ];
    let grew = true;
    while (grew) {
      grew = false;
      for (const candidate of openEntities) {
        if (used.has(candidate.handle)) continue;
        const cends = endpointsOf(candidate.entity);
        for (let ci = 0; ci < 2; ci++) {
          for (let fi = frontier.length - 1; fi >= 0; fi--) {
            if (samePoint(cends[ci][0], frontier[fi].pt) || samePoint(cends[ci][1], frontier[fi].pt)) {
              used.add(candidate.handle);
              const otherEnd = ci === 0 ? cends[ci][1] : cends[ci][0];
              frontier = frontier.filter((f) => f.from !== frontier[fi].from);
              frontier.push({ pt: cends[ci][0], from: candidate.handle }, { pt: cends[ci][1], from: candidate.handle });
              chain.push(candidate);
              grew = true;
              break;
            }
          }
          if (grew) break;
        }
        if (grew) break;
      }
    }
    loops.push(chain);
  }
  return loops.filter((loop) => loop.length > 0);
}

export function findHatchBoundary(model: DrawingModel, seed: Pt, options?: { ignoreFrozenLayers?: boolean }): HatchBoundary | null {
  const candidates: LoopEntity[] = [];
  for (const handle of model.order) {
    const entity = model.entities[handle];
    if (!entity) continue;
    if (entity.type === 'hatch' || entity.type === 'dimension' || entity.type === 'insert') continue;
    const layer = model.layers[entity.layer];
    if (!layer) continue;
    if (layer.frozen) continue;
    if (!layer.on) continue;
    candidates.push({ handle, entity });
  }
  const loops: Array<{ parts: LoopEntity[]; polygon: Pt[]; area: number }> = [];
  for (const candidate of candidates) {
    const pl = polylineLoop(candidate.entity);
    if (pl && pointInPolygon(seed, pl)) {
      loops.push({ parts: [candidate], polygon: pl, area: closedPolylineArea(candidate.entity as Extract<Entity, { type: 'pline' }>) });
      continue;
    }
    const cl = circleLoop(candidate.entity);
    if (cl && pointInPolygon(seed, cl)) {
      const area = circleArea((candidate.entity as Extract<Entity, { type: 'circle' }>).r);
      loops.push({ parts: [candidate], polygon: cl, area });
    }
  }
  for (const chain of chainLoops(candidates, false, model.layers)) {
    if (chain.length < 2) continue;
    const poly = loopPolygon(chain);
    if (!poly) continue;
    if (!pointInPolygon(seed, poly)) continue;
    const area = loopArea(chain);
    if (area === null) continue;
    loops.push({ parts: chain, polygon: poly, area });
  }
  if (!loops.length) return null;
  loops.sort((a, b) => a.area - b.area);
  const outer = loops[0];
  const islands = loops.slice(1).filter((loop) => {
    const inside = loop.polygon.every((p) => pointInPolygon(p, outer.polygon));
    if (!inside) return false;
    const minx = Math.min(...loop.polygon.map((p) => p.x));
    const miny = Math.min(...loop.polygon.map((p) => p.y));
    return pointInPolygon({ x: minx - 0, y: miny - 0 }, outer.polygon) && pointInPolygon({ x: minx, y: miny }, outer.polygon);
  });
  const area = round6(outer.area - islands.reduce((sum, i) => sum + i.area, 0));
  return {
    handles: outer.parts.map((p) => p.handle),
    outer: outer.polygon,
    islands: islands.map((i) => ({ handles: i.parts.map((p) => p.handle), polygon: i.polygon })),
    area,
  };
}

export function hatchAssociative(model: DrawingModel, seed: Pt, boundaryHandles: string[]): boolean {
  if (!boundaryHandles.length) return false;
  return boundaryHandles.every((handle) => {
    const entity = model.entities[handle];
    if (!entity) return false;
    void model;
    void seed;
    return true;
  });
}

// ---------------------------------------------------------------------------
// Constraints and parameters
// ---------------------------------------------------------------------------

const PARAM_NAME = /^d\d+$/;

export function expressionError(kind: string, detail: string): string {
  if (kind === 'cycle') return `Expression cycle: ${detail}.`;
  if (kind === 'unknown') return `Unknown parameter: ${detail}.`;
  return `Expression divides by zero: ${detail}.`;
}

export function evaluateExpression(
  expression: string,
  params: Record<string, string>,
  seen: Set<string> = new Set(),
): { value: number | null; error: string | null; errorKind: string | null; errorDetail: string | null } {
  const names = Object.keys(params);
  const tokens = expression.match(/[-+*/()]*\s*[A-Za-z_][A-Za-z0-9_]*/g) ?? [];
  for (const raw of tokens) {
    const name = raw.trim();
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
      if (name === 'd' || PARAM_NAME.test(name)) {
        if (!(name in params)) return { value: null, error: expressionError('unknown', name), errorKind: 'unknown', errorDetail: name };
        if (seen.has(name)) {
          const chain = [...seen, name].join(' -> ');
          return { value: null, error: expressionError('cycle', chain), errorKind: 'cycle', errorDetail: chain };
        }
        const inner = evaluateExpression(params[name], params, new Set([...seen, name]));
        if (inner.error) return inner;
      } else {
        return { value: null, error: expressionError('unknown', name), errorKind: 'unknown', errorDetail: name };
      }
    }
  }
  const substituted = expression.replace(/[A-Za-z_][A-Za-z0-9_]*/g, (name) => {
    if (name === 'd' || PARAM_NAME.test(name)) {
      return name;
    }
    return name;
  });
  const values: Record<string, number> = {};
  for (const name of names) {
    const inner = evaluateExpression(params[name], params, new Set([...seen, name]));
    if (inner.error) return { value: null, error: inner.error, errorKind: inner.errorKind, errorDetail: inner.errorDetail };
    values[name] = inner.value ?? 0;
  }
  let expr = expression;
  for (const name of Object.keys(values)) {
    expr = expr.split(name).join(`(${values[name]})`);
  }
  // Guard identifiers that were not parameter names.
  if (/[A-Za-z_]/.test(expr.replace(/\(/g, '').replace(/\)/g, ''))) {
    const match = expr.match(/[A-Za-z_][A-Za-z0-9_]*/);
    if (match) return { value: null, error: expressionError('unknown', match[0]), errorKind: 'unknown', errorDetail: match[0] };
  }
  try {
    const fn = new Function(`"use strict";return (${expr});`) as () => number;
    const value = fn();
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return { value: null, error: expressionError('unknown', expr), errorKind: 'unknown', errorDetail: expr };
    }
    return { value, error: null, errorKind: null, errorDetail: null };
  } catch {
    const match = expr.match(/[A-Za-z_][A-Za-z0-9_]*/);
    const name = match ? match[0] : expression;
    return { value: null, error: expressionError('unknown', name), errorKind: 'unknown', errorDetail: name };
  }
}

export function expressionCycle(expression: string, params: Record<string, string>): string | null {
  const visit = (name: string, chain: string[]): string | null => {
    if (chain.includes(name)) {
      const idx = chain.indexOf(name);
      return [...chain.slice(idx), name].join(' -> ');
    }
    if (!(name in params)) return null;
    const referenced = paramRefs(params[name]);
    for (const ref of referenced) {
      if (ref in params) {
        const result = visit(ref, [...chain, name]);
        if (result) return result;
      }
    }
    return null;
  };
  for (const name of Object.keys(params)) {
    const refs = paramRefs(params[name]);
    for (const ref of refs) {
      if (ref in params) {
        const result = visit(ref, [name]);
        if (result) return result;
      }
    }
  }
  void expression;
  return null;
}

export function paramRefs(expression: string): string[] {
  return expression.match(/[A-Za-z_][A-Za-z0-9_]*/g)?.filter((n) => n === 'd' || PARAM_NAME.test(n)) ?? [];
}

export function isParameterName(name: string): boolean {
  return PARAM_NAME.test(name);
}

export interface ConstraintSolveFailure {
  kind: 'over' | 'expression';
  message: string;
}

export function constraintLabel(kind: ConstraintKind, handles: string[], expression: string | null): string {
  const refs = handles.join(' ');
  if (kind === 'length' || kind === 'radius') {
    return `${kind} ${refs} = ${expression ?? ''}`;
  }
  return `${kind} ${refs}`;
}

export function constraintSatisfied(
  model: DrawingModel,
  constraint: { kind: ConstraintKind; refs: Array<{ handle: string; point: null | 'start' | 'end' }>; expression: string | null },
  values: Record<string, number>,
): boolean {
  const entityA = model.entities[constraint.refs[0]?.handle ?? ''];
  const entityB = model.entities[constraint.refs[1]?.handle ?? ''];
  const TOL = 0.0001;
  switch (constraint.kind) {
    case 'horizontal':
      return entityA?.type === 'line' && Math.abs(entityA.y1 - entityA.y2) <= TOL;
    case 'vertical':
      return entityA?.type === 'line' && Math.abs(entityA.x1 - entityA.x2) <= TOL;
    case 'parallel': {
      if (entityA?.type !== 'line' || entityB?.type !== 'line') return false;
      const a1 = Math.atan2(entityA.y2 - entityA.y1, entityA.x2 - entityA.x1);
      const b1 = Math.atan2(entityB.y2 - entityB.y1, entityB.x2 - entityB.x1);
      let diff = Math.abs(a1 - b1) % Math.PI;
      return diff <= TOL || Math.PI - diff <= TOL;
    }
    case 'perpendicular': {
      if (entityA?.type !== 'line' || entityB?.type !== 'line') return false;
      const a1 = Math.atan2(entityA.y2 - entityA.y1, entityA.x2 - entityA.x1);
      const b1 = Math.atan2(entityB.y2 - entityB.y1, entityB.x2 - entityB.x1);
      const diff = Math.abs(a1 - b1) % (Math.PI / 2);
      return diff <= TOL || Math.PI / 2 - diff <= TOL;
    }
    case 'equal': {
      const la = entityA?.type === 'line' ? Math.hypot(entityA.x2 - entityA.x1, entityA.y2 - entityA.y1) : null;
      const lb = entityB?.type === 'line' ? Math.hypot(entityB.x2 - entityB.x1, entityB.y2 - entityB.y1) : null;
      return la !== null && lb !== null && Math.abs(la - lb) <= TOL;
    }
    case 'coincident': {
      const a = pointOfRef(model, constraint.refs[0]);
      const b = pointOfRef(model, constraint.refs[1]);
      return a !== null && b !== null && Math.hypot(a.x - b.x, a.y - b.y) <= TOL;
    }
    case 'fixed':
      return true;
    case 'length': {
      if (entityA?.type !== 'line' || !constraint.expression) return false;
      const len = Math.hypot(entityA.x2 - entityA.x1, entityA.y2 - entityA.y1);
      const target = values[expressionValueKey(constraint.expression)] ?? Number(evaluateExpression(constraint.expression, paramsRecord(model, values)).value ?? NaN);
      return Number.isFinite(target) && Math.abs(len - target) <= TOL;
    }
    case 'radius': {
      const ent = entityA;
      if (!ent || (ent.type !== 'circle' && ent.type !== 'arc') || !constraint.expression) return false;
      const target = values[expressionValueKey(constraint.expression)] ?? Number(evaluateExpression(constraint.expression, paramsRecord(model, values)).value ?? NaN);
      return Number.isFinite(target) && Math.abs(ent.r - target) <= TOL;
    }
  }
}

export function paramsRecord(model: DrawingModel, values: Record<string, number>): Record<string, string> {
  const record: Record<string, string> = {};
  for (const param of model.parameters) record[param.name] = param.expression;
  void values;
  return record;
}

function expressionValueKey(expression: string): string {
  return expression.trim();
}

export function pointOfRef(model: Pick<DrawingModel, 'entities'>, ref: { handle: string; point: null | 'start' | 'end' } | undefined): Pt | null {
  if (!ref) return null;
  const entity = model.entities[ref.handle];
  if (!entity) return null;
  if (ref.point === 'start') {
    if (entity.type === 'line') return { x: entity.x1, y: entity.y1 };
    if (entity.type === 'pline' && entity.points.length) return entity.points[0];
  }
  if (ref.point === 'end') {
    if (entity.type === 'line') return { x: entity.x2, y: entity.y2 };
    if (entity.type === 'pline' && entity.points.length) return entity.points[entity.points.length - 1];
  }
  if (entity.type === 'line') return { x: entity.x1, y: entity.y1 };
  return null;
}

export function roundToPolygon(p: Pt): Pt {
  return p;
}

// ---------------------------------------------------------------------------
// Compare
// ---------------------------------------------------------------------------

export type DiffState = 'added' | 'removed' | 'changed' | 'same';

export interface CompareEntity {
  id: string;
  diff: DiffState;
}

export function compareEntities(
  earlier: { entities: Record<string, Entity> },
  later: { entities: Record<string, Entity> },
): { added: number; removed: number; changed: number; entities: CompareEntity[] } {
  const added: CompareEntity[] = [];
  const removed: CompareEntity[] = [];
  const changed: CompareEntity[] = [];
  const same: CompareEntity[] = [];
  for (const id of Object.keys(later.entities)) {
    const before = earlier.entities[id];
    if (!before) {
      added.push({ id, diff: 'added' });
    } else if (!entityEqual(before, later.entities[id])) {
      changed.push({ id, diff: 'changed' });
    } else {
      same.push({ id, diff: 'same' });
    }
  }
  for (const id of Object.keys(earlier.entities)) {
    if (!later.entities[id]) removed.push({ id, diff: 'removed' });
  }
  return {
    added: added.length,
    removed: removed.length,
    changed: changed.length,
    entities: [...added, ...removed, ...changed, ...same],
  };
}

function entityEqual(a: Entity, b: Entity): boolean {
  if (a.type !== b.type || a.layer !== b.layer) return false;
  const an = JSON.stringify(a);
  const bn = JSON.stringify(b);
  if (an === bn) return true;
  return nearlyEqualLoose(a, b);
}

function nearlyEqualLoose(a: Entity, b: Entity): boolean {
  const ka = a.type === 'pline' ? JSON.stringify(a.points) : '';
  const kb = b.type === 'pline' ? JSON.stringify(b.points) : '';
  if (ka !== kb) return false;
  switch (a.type) {
    case 'line': {
      if (b.type !== 'line') return false;
      return nearly(a.x1, b.x1) && nearly(a.y1, b.y1) && nearly(a.x2, b.x2) && nearly(a.y2, b.y2);
    }
    case 'circle': {
      if (b.type !== 'circle') return false;
      return nearly(a.cx, b.cx) && nearly(a.cy, b.cy) && nearly(a.r, b.r);
    }
    case 'arc': {
      if (b.type !== 'arc') return false;
      return nearly(a.cx, b.cx) && nearly(a.cy, b.cy) && nearly(a.r, b.r) && nearly(a.start, b.start) && nearly(a.end, b.end);
    }
    case 'insert': {
      if (b.type !== 'insert') return false;
      return a.block === b.block && nearly(a.x, b.x) && nearly(a.y, b.y) && nearly(a.scale, b.scale) && nearly(a.rotation, b.rotation) && JSON.stringify(a.attributes) === JSON.stringify(b.attributes);
    }
    case 'hatch':
      return b.type === 'hatch' && nearly(a.seed_x, b.seed_x) && nearly(a.seed_y, b.seed_y);
    case 'dimension':
      return b.type === 'dimension' && a.kind === b.kind && a.style === b.style && JSON.stringify(a.refs) === JSON.stringify(b.refs) && a.override === b.override;
    case 'pline':
      return b.type === 'pline' && a.closed === b.closed && a.points.length === b.points.length;
  }
}

export function boxesMeet(
  a: { minX: number; minY: number; maxX: number; maxY: number },
  b: { minX: number; minY: number; maxX: number; maxY: number },
): boolean {
  return a.minX <= b.maxX && b.minX <= a.maxX && a.minY <= b.maxY && b.minY <= a.maxY;
}
