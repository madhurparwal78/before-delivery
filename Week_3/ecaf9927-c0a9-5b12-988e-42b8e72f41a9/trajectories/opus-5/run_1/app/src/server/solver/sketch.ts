import type { ConstraintKind, EntityGeometry, EntityType } from '../../shared/api.js';
import { decompose, pointFreedom, type Equation, type Gradient } from './linalg.js';

export const ORIGIN_REF = 'origin';

export type SolverEntity = {
  id: string;
  type: EntityType;
  geometry: EntityGeometry;
};

export type SolverConstraint = {
  id: string;
  kind: ConstraintKind;
  refs: string[];
  valueMm: number | null;
  fixAt: { x: number; y: number } | null;
};

export type PointSlot = { entityId: string; part: 'self' | 'start' | 'end' | 'center' };

export type SolvedSketch = {
  geometry: Map<string, EntityGeometry>;
  slack: number;
  totalFreedom: number;
  redundant: Set<string>;
  /** Keyed by point ref, e.g. `<entity id>.start`. */
  freedoms: Map<string, 0 | 1 | 2>;
};

const RESIDUAL_TOLERANCE = 1e-9;
const DEGENERATE_TOLERANCE = 1e-7;
const MAX_ITERATIONS = 80;
const RESTART_SCALES = [0.05, 0.5, 2, 10, 40, 200];

export const ENTITY_FREEDOM: Record<EntityType, number> = {
  point: 2,
  line: 4,
  circle: 3,
  arc: 5,
};

type Layout = { base: number; type: EntityType };

function layoutOf(entities: SolverEntity[]): { layouts: Map<string, Layout>; size: number } {
  const layouts = new Map<string, Layout>();
  let size = 0;
  for (const entity of entities) {
    layouts.set(entity.id, { base: size, type: entity.type });
    size += ENTITY_FREEDOM[entity.type];
  }
  return { layouts, size };
}

function pack(entities: SolverEntity[], size: number): Float64Array {
  const values = new Float64Array(size);
  let base = 0;
  for (const entity of entities) {
    const g = entity.geometry;
    if (g.type === 'point') {
      values[base] = g.x;
      values[base + 1] = g.y;
    } else if (g.type === 'line') {
      values[base] = g.start.x;
      values[base + 1] = g.start.y;
      values[base + 2] = g.end.x;
      values[base + 3] = g.end.y;
    } else if (g.type === 'circle') {
      values[base] = g.center.x;
      values[base + 1] = g.center.y;
      values[base + 2] = g.radius;
    } else {
      values[base] = g.center.x;
      values[base + 1] = g.center.y;
      values[base + 2] = g.radius;
      values[base + 3] = (g.start_angle_deg * Math.PI) / 180;
      values[base + 4] = (g.end_angle_deg * Math.PI) / 180;
    }
    base += ENTITY_FREEDOM[entity.type];
  }
  return values;
}

function unpack(entities: SolverEntity[], values: Float64Array): Map<string, EntityGeometry> {
  const geometry = new Map<string, EntityGeometry>();
  let base = 0;
  for (const entity of entities) {
    const at = (offset: number): number => values[base + offset] as number;
    if (entity.type === 'point') {
      geometry.set(entity.id, { type: 'point', x: at(0), y: at(1) });
    } else if (entity.type === 'line') {
      geometry.set(entity.id, {
        type: 'line',
        start: { x: at(0), y: at(1) },
        end: { x: at(2), y: at(3) },
      });
    } else if (entity.type === 'circle') {
      geometry.set(entity.id, { type: 'circle', center: { x: at(0), y: at(1) }, radius: at(2) });
    } else {
      geometry.set(entity.id, {
        type: 'arc',
        center: { x: at(0), y: at(1) },
        radius: at(2),
        start_angle_deg: normaliseDegrees((at(3) * 180) / Math.PI),
        end_angle_deg: normaliseDegrees((at(4) * 180) / Math.PI),
      });
    }
    base += ENTITY_FREEDOM[entity.type];
  }
  return geometry;
}

function normaliseDegrees(degrees: number): number {
  const wrapped = degrees % 360;
  return wrapped < 0 ? wrapped + 360 : wrapped;
}

type PointExpr = { x: number; y: number; gx: Gradient; gy: Gradient };

const ORIGIN_EXPR: PointExpr = { x: 0, y: 0, gx: { cols: [], grads: [] }, gy: { cols: [], grads: [] } };

export function parsePointRef(ref: string): { entityId: string; part: PointSlot['part'] } {
  const dot = ref.lastIndexOf('.');
  if (dot < 0) return { entityId: ref, part: 'self' };
  const suffix = ref.slice(dot + 1);
  if (suffix === 'start' || suffix === 'end' || suffix === 'center') {
    return { entityId: ref.slice(0, dot), part: suffix };
  }
  return { entityId: ref, part: 'self' };
}

function pointExpr(
  ref: string,
  layouts: Map<string, Layout>,
  values: Float64Array,
): PointExpr | null {
  if (ref === ORIGIN_REF) return ORIGIN_EXPR;
  const { entityId, part } = parsePointRef(ref);
  const layout = layouts.get(entityId);
  if (!layout) return null;
  const base = layout.base;
  const at = (offset: number): number => values[base + offset] as number;
  if (layout.type === 'point') {
    if (part !== 'self') return null;
    return {
      x: at(0),
      y: at(1),
      gx: { cols: [base], grads: [1] },
      gy: { cols: [base + 1], grads: [1] },
    };
  }
  if (layout.type === 'line') {
    const offset = part === 'start' ? 0 : part === 'end' ? 2 : -1;
    if (offset < 0) return null;
    return {
      x: at(offset),
      y: at(offset + 1),
      gx: { cols: [base + offset], grads: [1] },
      gy: { cols: [base + offset + 1], grads: [1] },
    };
  }
  if (layout.type === 'circle') {
    if (part !== 'center') return null;
    return {
      x: at(0),
      y: at(1),
      gx: { cols: [base], grads: [1] },
      gy: { cols: [base + 1], grads: [1] },
    };
  }
  if (part === 'center') {
    return {
      x: at(0),
      y: at(1),
      gx: { cols: [base], grads: [1] },
      gy: { cols: [base + 1], grads: [1] },
    };
  }
  if (part !== 'start' && part !== 'end') return null;
  const angleOffset = part === 'start' ? 3 : 4;
  const radius = at(2);
  const angle = at(angleOffset);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return {
    x: at(0) + radius * cos,
    y: at(1) + radius * sin,
    gx: { cols: [base, base + 2, base + angleOffset], grads: [1, cos, -radius * sin] },
    gy: { cols: [base + 1, base + 2, base + angleOffset], grads: [1, sin, radius * cos] },
  };
}

function combine(terms: { g: Gradient; scale: number }[]): Gradient {
  const cols: number[] = [];
  const grads: number[] = [];
  for (const term of terms) {
    for (let i = 0; i < term.g.cols.length; i += 1) {
      cols.push(term.g.cols[i] as number);
      grads.push((term.g.grads[i] as number) * term.scale);
    }
  }
  return { cols, grads };
}

type LineParts = { base: number; dx: number; dy: number; length: number };

function lineParts(ref: string, layouts: Map<string, Layout>, values: Float64Array): LineParts | null {
  const layout = layouts.get(ref);
  if (!layout || layout.type !== 'line') return null;
  const base = layout.base;
  const dx = (values[base + 2] as number) - (values[base] as number);
  const dy = (values[base + 3] as number) - (values[base + 1] as number);
  return { base, dx, dy, length: Math.hypot(dx, dy) };
}

function radiusSlot(ref: string, layouts: Map<string, Layout>): number | null {
  const layout = layouts.get(ref);
  if (!layout || (layout.type !== 'circle' && layout.type !== 'arc')) return null;
  return layout.base + 2;
}

/** Equations for one constraint. An empty list means its references do not fit its kind. */
function constraintEquations(
  constraint: SolverConstraint,
  layouts: Map<string, Layout>,
  values: Float64Array,
): Equation[] {
  const value = constraint.valueMm ?? 0;
  const points = (count: number): PointExpr[] | null => {
    if (constraint.refs.length !== count) return null;
    const list: PointExpr[] = [];
    for (const ref of constraint.refs) {
      const expr = pointExpr(ref, layouts, values);
      if (!expr) return null;
      list.push(expr);
    }
    return list;
  };

  switch (constraint.kind) {
    case 'coincident': {
      const pair = points(2);
      if (!pair) return [];
      const [p, q] = pair as [PointExpr, PointExpr];
      return [
        { residual: p.x - q.x, ...combine([{ g: p.gx, scale: 1 }, { g: q.gx, scale: -1 }]) },
        { residual: p.y - q.y, ...combine([{ g: p.gy, scale: 1 }, { g: q.gy, scale: -1 }]) },
      ];
    }
    case 'fix': {
      const pair = points(1);
      if (!pair || !constraint.fixAt) return [];
      const [p] = pair as [PointExpr];
      return [
        { residual: p.x - constraint.fixAt.x, ...p.gx },
        { residual: p.y - constraint.fixAt.y, ...p.gy },
      ];
    }
    case 'horizontal':
    case 'vertical': {
      if (constraint.refs.length !== 1) return [];
      const line = lineParts(constraint.refs[0] as string, layouts, values);
      if (!line) return [];
      const offset = constraint.kind === 'horizontal' ? 1 : 0;
      return [
        {
          residual: constraint.kind === 'horizontal' ? line.dy : line.dx,
          cols: [line.base + offset, line.base + offset + 2],
          grads: [-1, 1],
        },
      ];
    }
    case 'parallel':
    case 'perpendicular': {
      if (constraint.refs.length !== 2) return [];
      const a = lineParts(constraint.refs[0] as string, layouts, values);
      const b = lineParts(constraint.refs[1] as string, layouts, values);
      if (!a || !b) return [];
      if (constraint.kind === 'parallel') {
        return [
          {
            residual: a.dx * b.dy - a.dy * b.dx,
            cols: [a.base, a.base + 2, a.base + 1, a.base + 3, b.base, b.base + 2, b.base + 1, b.base + 3],
            grads: [-b.dy, b.dy, b.dx, -b.dx, a.dy, -a.dy, -a.dx, a.dx],
          },
        ];
      }
      return [
        {
          residual: a.dx * b.dx + a.dy * b.dy,
          cols: [a.base, a.base + 2, a.base + 1, a.base + 3, b.base, b.base + 2, b.base + 1, b.base + 3],
          grads: [-b.dx, b.dx, -b.dy, b.dy, -a.dx, a.dx, -a.dy, a.dy],
        },
      ];
    }
    case 'equal': {
      if (constraint.refs.length !== 2) return [];
      const firstRadius = radiusSlot(constraint.refs[0] as string, layouts);
      const secondRadius = radiusSlot(constraint.refs[1] as string, layouts);
      if (firstRadius !== null && secondRadius !== null) {
        return [
          {
            residual: (values[firstRadius] as number) - (values[secondRadius] as number),
            cols: [firstRadius, secondRadius],
            grads: [1, -1],
          },
        ];
      }
      const a = lineParts(constraint.refs[0] as string, layouts, values);
      const b = lineParts(constraint.refs[1] as string, layouts, values);
      if (!a || !b || a.length === 0 || b.length === 0) return [];
      return [
        {
          residual: a.length - b.length,
          cols: [a.base, a.base + 2, a.base + 1, a.base + 3, b.base, b.base + 2, b.base + 1, b.base + 3],
          grads: [
            -a.dx / a.length,
            a.dx / a.length,
            -a.dy / a.length,
            a.dy / a.length,
            b.dx / b.length,
            -b.dx / b.length,
            b.dy / b.length,
            -b.dy / b.length,
          ],
        },
      ];
    }
    case 'distance': {
      if (constraint.refs.length === 1) {
        const line = lineParts(constraint.refs[0] as string, layouts, values);
        if (!line || line.length === 0) return [];
        return [
          {
            residual: line.length - value,
            cols: [line.base, line.base + 2, line.base + 1, line.base + 3],
            grads: [-line.dx / line.length, line.dx / line.length, -line.dy / line.length, line.dy / line.length],
          },
        ];
      }
      const pair = points(2);
      if (!pair) return [];
      const [p, q] = pair as [PointExpr, PointExpr];
      const dx = q.x - p.x;
      const dy = q.y - p.y;
      const length = Math.hypot(dx, dy);
      if (length === 0) return [];
      return [
        {
          residual: length - value,
          ...combine([
            { g: q.gx, scale: dx / length },
            { g: p.gx, scale: -dx / length },
            { g: q.gy, scale: dy / length },
            { g: p.gy, scale: -dy / length },
          ]),
        },
      ];
    }
    case 'horizontal_distance':
    case 'vertical_distance': {
      const pair = points(2);
      if (!pair) return [];
      const [p, q] = pair as [PointExpr, PointExpr];
      const horizontal = constraint.kind === 'horizontal_distance';
      const separation = horizontal ? q.x - p.x : q.y - p.y;
      const gq = horizontal ? q.gx : q.gy;
      const gp = horizontal ? p.gx : p.gy;
      return [
        {
          residual: separation - value,
          ...combine([{ g: gq, scale: 1 }, { g: gp, scale: -1 }]),
        },
      ];
    }
    case 'diameter':
    case 'radius': {
      if (constraint.refs.length !== 1) return [];
      const slot = radiusSlot(constraint.refs[0] as string, layouts);
      if (slot === null) return [];
      const factor = constraint.kind === 'diameter' ? 2 : 1;
      return [
        { residual: factor * (values[slot] as number) - value, cols: [slot], grads: [factor] },
      ];
    }
  }
}

/** True when the references fit the constraint kind. */
export function referencesFit(
  constraint: SolverConstraint,
  entities: SolverEntity[],
): boolean {
  const { layouts, size } = layoutOf(entities);
  const probe: SolverConstraint =
    constraint.kind === 'fix' ? { ...constraint, fixAt: { x: 0, y: 0 } } : constraint;
  return constraintEquations(probe, layouts, placeholderValues(entities, size)).length > 0;
}

/** Non-degenerate stand-in values, so reference checks never trip over zero-length geometry. */
function placeholderValues(entities: SolverEntity[], size: number): Float64Array {
  const values = pack(entities, size);
  let base = 0;
  for (const entity of entities) {
    if (entity.type === 'line') {
      if (Math.hypot((values[base + 2] as number) - (values[base] as number), (values[base + 3] as number) - (values[base + 1] as number)) === 0) {
        values[base + 2] = (values[base] as number) + 1;
      }
    } else if (entity.type === 'circle' || entity.type === 'arc') {
      if ((values[base + 2] as number) === 0) values[base + 2] = 1;
    }
    base += ENTITY_FREEDOM[entity.type];
  }
  return values;
}

function buildEquations(
  constraints: SolverConstraint[],
  layouts: Map<string, Layout>,
  values: Float64Array,
): { equations: Equation[]; spans: { id: string; from: number; to: number }[] } {
  const equations: Equation[] = [];
  const spans: { id: string; from: number; to: number }[] = [];
  for (const constraint of constraints) {
    const from = equations.length;
    equations.push(...constraintEquations(constraint, layouts, values));
    spans.push({ id: constraint.id, from, to: equations.length });
  }
  return { equations, spans };
}

function maxAbsResidual(equations: Equation[]): number {
  let worst = 0;
  for (const equation of equations) worst = Math.max(worst, Math.abs(equation.residual));
  return worst;
}

function degenerate(entities: SolverEntity[], values: Float64Array): boolean {
  let base = 0;
  for (const entity of entities) {
    if (entity.type === 'line') {
      const dx = (values[base + 2] as number) - (values[base] as number);
      const dy = (values[base + 3] as number) - (values[base + 1] as number);
      if (Math.hypot(dx, dy) <= DEGENERATE_TOLERANCE) return true;
    } else if (entity.type === 'circle' || entity.type === 'arc') {
      if ((values[base + 2] as number) <= DEGENERATE_TOLERANCE) return true;
    }
    base += ENTITY_FREEDOM[entity.type];
  }
  return false;
}

function runNewton(
  entities: SolverEntity[],
  constraints: SolverConstraint[],
  layouts: Map<string, Layout>,
  size: number,
  start: Float64Array,
): Float64Array | null {
  const values = Float64Array.from(start);
  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration += 1) {
    const { equations } = buildEquations(constraints, layouts, values);
    const worst = maxAbsResidual(equations);
    if (worst <= RESIDUAL_TOLERANCE) {
      return degenerate(entities, values) ? null : values;
    }
    const { step } = decompose(equations, size);
    let scale = 1;
    let improved = false;
    for (let attempt = 0; attempt < 24; attempt += 1) {
      const candidate = Float64Array.from(values);
      for (let i = 0; i < size; i += 1) {
        candidate[i] = (candidate[i] as number) + scale * (step[i] as number);
      }
      const next = buildEquations(constraints, layouts, candidate);
      if (next.equations.length !== equations.length) {
        scale /= 2;
        continue;
      }
      if (maxAbsResidual(next.equations) < worst) {
        values.set(candidate);
        improved = true;
        break;
      }
      scale /= 2;
    }
    if (!improved) return null;
  }
  return null;
}

function perturb(start: Float64Array, scale: number, seed: number): Float64Array {
  const values = Float64Array.from(start);
  let state = seed * 2654435761 + 1;
  const random = (): number => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff - 0.5;
  };
  for (let i = 0; i < values.length; i += 1) {
    values[i] = (values[i] as number) + random() * scale;
  }
  return values;
}

/**
 * Solves the sketch, moving the geometry as little as possible, then reports the slack,
 * point freedoms and which constraints turned out redundant.
 */
export function solveSketch(
  entities: SolverEntity[],
  constraints: SolverConstraint[],
): SolvedSketch | null {
  const { layouts, size } = layoutOf(entities);
  const start = pack(entities, size);
  let solved = runNewton(entities, constraints, layouts, size, start);
  for (let attempt = 0; solved === null && attempt < RESTART_SCALES.length; attempt += 1) {
    const perturbed = perturb(start, RESTART_SCALES[attempt] as number, attempt + 1);
    solved = runNewton(entities, constraints, layouts, size, perturbed);
  }
  if (solved === null) return null;

  const { equations, spans } = buildEquations(constraints, layouts, solved);
  const { rank, basis, independent } = decompose(equations, size);
  const redundant = new Set<string>();
  for (const span of spans) {
    let contributes = false;
    for (let i = span.from; i < span.to; i += 1) if (independent[i]) contributes = true;
    if (!contributes) redundant.add(span.id);
  }

  const freedoms = new Map<string, 0 | 1 | 2>();
  for (const slot of pointSlots(entities)) {
    const ref = pointRefOf(slot);
    const expr = pointExpr(ref, layouts, solved);
    if (!expr) continue;
    freedoms.set(ref, pointFreedom(basis, rank, size, expr.gx, expr.gy));
  }

  return {
    geometry: unpack(entities, solved),
    slack: size - rank,
    totalFreedom: size,
    redundant,
    freedoms,
  };
}

export function pointRefOf(slot: PointSlot): string {
  return slot.part === 'self' ? slot.entityId : `${slot.entityId}.${slot.part}`;
}

/** Every selectable point of the sketch, in entity order. */
export function pointSlots(entities: SolverEntity[]): PointSlot[] {
  const slots: PointSlot[] = [];
  for (const entity of entities) {
    if (entity.type === 'point') slots.push({ entityId: entity.id, part: 'self' });
    else if (entity.type === 'line') {
      slots.push({ entityId: entity.id, part: 'start' });
      slots.push({ entityId: entity.id, part: 'end' });
    } else if (entity.type === 'circle') slots.push({ entityId: entity.id, part: 'center' });
    else {
      slots.push({ entityId: entity.id, part: 'center' });
      slots.push({ entityId: entity.id, part: 'start' });
      slots.push({ entityId: entity.id, part: 'end' });
    }
  }
  return slots;
}

/**
 * Horizontal and vertical distances measure a signed separation, so the references are
 * stored in the order that makes the separation positive.
 */
export function orderSeparationRefs(
  kind: ConstraintKind,
  refs: string[],
  entities: SolverEntity[],
): string[] {
  if (kind !== 'horizontal_distance' && kind !== 'vertical_distance') return refs;
  const { layouts, size } = layoutOf(entities);
  const values = pack(entities, size);
  const first = pointExpr(refs[0] as string, layouts, values);
  const second = pointExpr(refs[1] as string, layouts, values);
  if (!first || !second) return refs;
  const separation = kind === 'horizontal_distance' ? second.x - first.x : second.y - first.y;
  return separation < 0 ? [refs[1] as string, refs[0] as string] : refs;
}
