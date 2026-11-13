import type { ConstraintKind, Entity, Point2 } from '../../shared/api';

/** A constraint as the solver sees it: stored facts only, no label. */
export interface SolverConstraint {
  id: string;
  kind: ConstraintKind;
  refs: string[];
  value?: number;
  /** Where a Fix holds its point. */
  anchor?: Point2;
  /** Direction of a horizontal or vertical distance: +1 when the second point is to the right of or above the first. */
  sign?: 1 | -1;
}

/** The precision the brief demands: every constraint holds within this many millimetres. */
const SOLVE_TOLERANCE_MM = 1e-9;
const MIN_SIZE_MM = 1e-6;
const MAX_ITERATIONS = 200;

const RAD = Math.PI / 180;

/** Every entity brings as much freedom as it owns numbers: point 2, line 4, circle 3, arc 5. */
const entityFreedom = (entity: Entity): number =>
  ({ point: 2, line: 4, circle: 3, arc: 5 })[entity.type];

interface Gradient {
  vars: number[];
  dx: number[];
  dy: number[];
}

interface PointValue {
  x: number;
  y: number;
  grad: Gradient;
}

const CONSTANT_POINT: PointValue = { x: 0, y: 0, grad: { vars: [], dx: [], dy: [] } };

/** One row of the constraint Jacobian over the whole sketch's variables. */
interface JacobianRow {
  cols: number[];
  vals: number[];
}

/** The variables of a sketch: every entity contributes a few numbers, laid out one after another. */
export class SketchVariables {
  readonly base = new Map<string, number>();
  readonly values: number[] = [];
  private readonly byId = new Map<string, Entity>();

  constructor(readonly entities: readonly Entity[]) {
    for (const entity of entities) {
      this.byId.set(entity.id, entity);
      this.base.set(entity.id, this.values.length);
      switch (entity.type) {
        case 'point':
          this.values.push(entity.x, entity.y);
          break;
        case 'line':
          this.values.push(entity.start.x, entity.start.y, entity.end.x, entity.end.y);
          break;
        case 'circle':
          this.values.push(entity.center.x, entity.center.y, entity.radius);
          break;
        case 'arc':
          this.values.push(entity.center.x, entity.center.y, entity.radius, entity.start_angle_deg * RAD, entity.end_angle_deg * RAD);
          break;
      }
    }
  }

  entity(id: string): Entity | undefined {
    return this.byId.get(id);
  }

  /** Resolves "origin", an entity id or "<entity id>.start|end|center" to a position and its gradient. */
  point(ref: string, x: readonly number[]): PointValue | undefined {
    if (ref === 'origin') return CONSTANT_POINT;
    const [id = '', part] = ref.split('.');
    const entity = this.byId.get(id);
    const b = this.base.get(id);
    if (!entity || b === undefined) return undefined;
    const at = (i: number) => x[b + i] as number;
    const planar = (ix: number, iy: number): PointValue => ({
      x: at(ix),
      y: at(iy),
      grad: { vars: [b + ix, b + iy], dx: [1, 0], dy: [0, 1] },
    });
    if (entity.type === 'point' && part === undefined) return planar(0, 1);
    if (entity.type === 'line' && part === 'start') return planar(0, 1);
    if (entity.type === 'line' && part === 'end') return planar(2, 3);
    if (entity.type === 'circle' && part === 'center') return planar(0, 1);
    if (entity.type === 'arc' && part === 'center') return planar(0, 1);
    if (entity.type === 'arc' && (part === 'start' || part === 'end')) {
      const angle = at(part === 'start' ? 3 : 4);
      const radius = at(2);
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const angleVar = b + (part === 'start' ? 3 : 4);
      return {
        x: at(0) + radius * cos,
        y: at(1) + radius * sin,
        grad: { vars: [b, b + 1, b + 2, angleVar], dx: [1, 0, cos, -radius * sin], dy: [0, 1, sin, radius * cos] },
      };
    }
    return undefined;
  }

  /** Writes solved variables back into entities (angles back to degrees). */
  apply(x: readonly number[]): Entity[] {
    return this.entities.map((entity) => {
      const b = this.base.get(entity.id) as number;
      const at = (i: number) => x[b + i] as number;
      switch (entity.type) {
        case 'point':
          return { ...entity, x: at(0), y: at(1) };
        case 'line':
          return { ...entity, start: { x: at(0), y: at(1) }, end: { x: at(2), y: at(3) } };
        case 'circle':
          return { ...entity, center: { x: at(0), y: at(1) }, radius: at(2) };
        case 'arc':
          return { ...entity, center: { x: at(0), y: at(1) }, radius: at(2), start_angle_deg: at(3) / RAD, end_angle_deg: at(4) / RAD };
      }
    });
  }
}

class RowBuilder {
  private readonly weights = new Map<number, number>();

  add(variable: number, weight: number): this {
    this.weights.set(variable, (this.weights.get(variable) ?? 0) + weight);
    return this;
  }

  addPoint(grad: Gradient, axis: 'dx' | 'dy', scale: number): this {
    grad.vars.forEach((variable, i) => this.add(variable, scale * (grad[axis][i] as number)));
    return this;
  }

  row(): JacobianRow {
    const cols: number[] = [];
    const vals: number[] = [];
    for (const [variable, weight] of this.weights) {
      if (weight !== 0) {
        cols.push(variable);
        vals.push(weight);
      }
    }
    return { cols, vals };
  }
}

interface Equation {
  residual: number;
  row: JacobianRow;
}

/** The residuals and Jacobian rows of one constraint, or undefined when its references do not resolve. */
function equations(c: SolverConstraint, vars: SketchVariables, x: readonly number[]): Equation[] | undefined {
  const lineAt = (ref: string) => {
    const entity = vars.entity(ref);
    const b = vars.base.get(ref);
    return entity?.type === 'line' && b !== undefined ? b : undefined;
  };
  const radiusAt = (ref: string) => {
    const entity = vars.entity(ref);
    const b = vars.base.get(ref);
    return (entity?.type === 'circle' || entity?.type === 'arc') && b !== undefined ? b + 2 : undefined;
  };
  const pair = () => {
    const p = vars.point(c.refs[0] ?? '', x);
    const q = vars.point(c.refs[1] ?? '', x);
    return p && q ? { p, q } : undefined;
  };
  const value = c.value ?? 0;
  switch (c.kind) {
    case 'coincident': {
      const pts = pair();
      if (!pts) return undefined;
      const { p, q } = pts;
      return [
        { residual: p.x - q.x, row: new RowBuilder().addPoint(p.grad, 'dx', 1).addPoint(q.grad, 'dx', -1).row() },
        { residual: p.y - q.y, row: new RowBuilder().addPoint(p.grad, 'dy', 1).addPoint(q.grad, 'dy', -1).row() },
      ];
    }
    case 'fix': {
      const p = vars.point(c.refs[0] ?? '', x);
      if (!p || !c.anchor) return undefined;
      return [
        { residual: p.x - c.anchor.x, row: new RowBuilder().addPoint(p.grad, 'dx', 1).row() },
        { residual: p.y - c.anchor.y, row: new RowBuilder().addPoint(p.grad, 'dy', 1).row() },
      ];
    }
    case 'horizontal':
    case 'vertical': {
      const b = lineAt(c.refs[0] ?? '');
      if (b === undefined) return undefined;
      const [lo, hi] = c.kind === 'horizontal' ? [b + 1, b + 3] : [b, b + 2];
      return [{ residual: (x[hi] as number) - (x[lo] as number), row: new RowBuilder().add(hi, 1).add(lo, -1).row() }];
    }
    case 'parallel':
    case 'perpendicular': {
      const a = lineAt(c.refs[0] ?? '');
      const b = lineAt(c.refs[1] ?? '');
      if (a === undefined || b === undefined) return undefined;
      const d1x = (x[a + 2] as number) - (x[a] as number);
      const d1y = (x[a + 3] as number) - (x[a + 1] as number);
      const d2x = (x[b + 2] as number) - (x[b] as number);
      const d2y = (x[b + 3] as number) - (x[b + 1] as number);
      const builder = new RowBuilder();
      if (c.kind === 'parallel') {
        builder.add(a + 2, d2y).add(a, -d2y).add(a + 3, -d2x).add(a + 1, d2x);
        builder.add(b + 2, -d1y).add(b, d1y).add(b + 3, d1x).add(b + 1, -d1x);
        return [{ residual: d1x * d2y - d1y * d2x, row: builder.row() }];
      }
      builder.add(a + 2, d2x).add(a, -d2x).add(a + 3, d2y).add(a + 1, -d2y);
      builder.add(b + 2, d1x).add(b, -d1x).add(b + 3, d1y).add(b + 1, -d1y);
      return [{ residual: d1x * d2x + d1y * d2y, row: builder.row() }];
    }
    case 'equal': {
      const a = lineAt(c.refs[0] ?? '');
      const b = lineAt(c.refs[1] ?? '');
      if (a !== undefined && b !== undefined) {
        const lengths = [a, b].map((i) => ({
          dx: (x[i + 2] as number) - (x[i] as number),
          dy: (x[i + 3] as number) - (x[i + 1] as number),
          i,
        }));
        const [l1, l2] = lengths as [(typeof lengths)[number], (typeof lengths)[number]];
        const builder = new RowBuilder();
        builder.add(l1.i + 2, 2 * l1.dx).add(l1.i, -2 * l1.dx).add(l1.i + 3, 2 * l1.dy).add(l1.i + 1, -2 * l1.dy);
        builder.add(l2.i + 2, -2 * l2.dx).add(l2.i, 2 * l2.dx).add(l2.i + 3, -2 * l2.dy).add(l2.i + 1, 2 * l2.dy);
        return [{ residual: l1.dx ** 2 + l1.dy ** 2 - l2.dx ** 2 - l2.dy ** 2, row: builder.row() }];
      }
      const ra = radiusAt(c.refs[0] ?? '');
      const rb = radiusAt(c.refs[1] ?? '');
      if (ra === undefined || rb === undefined) return undefined;
      return [{ residual: (x[ra] as number) - (x[rb] as number), row: new RowBuilder().add(ra, 1).add(rb, -1).row() }];
    }
    case 'distance': {
      const line = lineAt(c.refs[0] ?? '');
      let ax: number, ay: number, bx: number, by: number;
      const builder = new RowBuilder();
      if (line !== undefined && c.refs.length === 1) {
        ax = x[line] as number;
        ay = x[line + 1] as number;
        bx = x[line + 2] as number;
        by = x[line + 3] as number;
        const length = Math.hypot(bx - ax, by - ay) || 1e-12;
        builder.add(line + 2, (bx - ax) / length).add(line, -(bx - ax) / length);
        builder.add(line + 3, (by - ay) / length).add(line + 1, -(by - ay) / length);
        return [{ residual: Math.hypot(bx - ax, by - ay) - value, row: builder.row() }];
      }
      const pts = pair();
      if (!pts) return undefined;
      const { p, q } = pts;
      const length = Math.hypot(q.x - p.x, q.y - p.y) || 1e-12;
      const ux = (q.x - p.x) / length;
      const uy = (q.y - p.y) / length;
      builder.addPoint(q.grad, 'dx', ux).addPoint(p.grad, 'dx', -ux).addPoint(q.grad, 'dy', uy).addPoint(p.grad, 'dy', -uy);
      return [{ residual: Math.hypot(q.x - p.x, q.y - p.y) - value, row: builder.row() }];
    }
    case 'horizontal_distance':
    case 'vertical_distance': {
      const pts = pair();
      if (!pts) return undefined;
      const { p, q } = pts;
      const axis = c.kind === 'horizontal_distance' ? 'dx' : 'dy';
      const sign = c.sign ?? 1;
      const separation = c.kind === 'horizontal_distance' ? q.x - p.x : q.y - p.y;
      return [
        { residual: separation - sign * value, row: new RowBuilder().addPoint(q.grad, axis, 1).addPoint(p.grad, axis, -1).row() },
      ];
    }
    case 'diameter':
    case 'radius': {
      const r = radiusAt(c.refs[0] ?? '');
      if (r === undefined) return undefined;
      const factor = c.kind === 'diameter' ? 2 : 1;
      return [{ residual: factor * (x[r] as number) - value, row: new RowBuilder().add(r, factor).row() }];
    }
  }
}

/** Entities a constraint talks about. */
function entitiesOf(c: SolverConstraint): string[] {
  return c.refs.filter((ref) => ref !== 'origin').map((ref) => ref.split('.')[0] as string);
}

class DisjointSets {
  private readonly parent = new Map<string, string>();

  find(a: string): string {
    const p = this.parent.get(a);
    if (p === undefined || p === a) {
      this.parent.set(a, a);
      return a;
    }
    const root = this.find(p);
    this.parent.set(a, root);
    return root;
  }

  union(a: string, b: string): void {
    this.parent.set(this.find(a), this.find(b));
  }
}

/** Groups constraints that share entities; each group is solved on its own. */
export function components(constraints: readonly SolverConstraint[]): SolverConstraint[][] {
  const sets = new DisjointSets();
  for (const c of constraints) {
    const ids = entitiesOf(c);
    ids.forEach((id) => sets.union(id, ids[0] as string));
  }
  const groups = new Map<string, SolverConstraint[]>();
  for (const c of constraints) {
    const first = entitiesOf(c)[0];
    const key = first === undefined ? c.id : sets.find(first);
    groups.set(key, [...(groups.get(key) ?? []), c]);
  }
  return [...groups.values()];
}

interface Evaluation {
  /** The residuals, and the same residuals divided by the size of their gradient so every one reads in millimetres. */
  raw: number[];
  worst: number;
  rows: JacobianRow[];
}

function evaluate(constraints: readonly SolverConstraint[], vars: SketchVariables, x: readonly number[]): Evaluation | undefined {
  const raw: number[] = [];
  const rows: JacobianRow[] = [];
  let worst = 0;
  for (const c of constraints) {
    const eqs = equations(c, vars, x);
    if (!eqs) return undefined;
    for (const eq of eqs) {
      raw.push(eq.residual);
      rows.push(eq.row);
      worst = Math.max(worst, Math.abs(eq.residual) / Math.max(1, Math.hypot(...eq.row.vals)));
    }
  }
  return { raw, worst, rows };
}

/** Cholesky solve of a symmetric positive definite system; undefined when it is not positive definite. */
function choleskySolve(a: Float64Array, n: number, b: Float64Array): Float64Array | undefined {
  const l = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = a[i * n + j] as number;
      for (let k = 0; k < j; k++) sum -= (l[i * n + k] as number) * (l[j * n + k] as number);
      if (i === j) {
        if (!(sum > 0)) return undefined;
        l[i * n + i] = Math.sqrt(sum);
      } else {
        l[i * n + j] = sum / (l[j * n + j] as number);
      }
    }
  }
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let sum = b[i] as number;
    for (let k = 0; k < i; k++) sum -= (l[i * n + k] as number) * (y[k] as number);
    y[i] = sum / (l[i * n + i] as number);
  }
  const out = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let sum = y[i] as number;
    for (let k = i + 1; k < n; k++) sum -= (l[k * n + i] as number) * (out[k] as number);
    out[i] = sum / (l[i * n + i] as number);
  }
  return out;
}

/** Moves the geometry as little as possible so every constraint holds. Returns the variables, or undefined when no shape fits. */
export function solve(constraints: readonly SolverConstraint[], vars: SketchVariables): number[] | undefined {
  let x = [...vars.values];
  let current = evaluate(constraints, vars, x);
  let lambda = 1e-6;
  for (let iteration = 0; current && iteration < MAX_ITERATIONS && current.worst > SOLVE_TOLERANCE_MM; iteration++) {
    const { rows, raw } = current;
    const m = rows.length;
    const lookups = rows.map((row) => new Map(row.cols.map((col, i) => [col, row.vals[i] as number])));
    const gram = new Float64Array(m * m);
    for (let i = 0; i < m; i++) {
      for (let j = 0; j <= i; j++) gram[i * m + j] = gram[j * m + i] = dotLookups(rows[i] as JacobianRow, lookups[j] as Map<number, number>);
    }
    let next: Evaluation | undefined;
    let moved: number[] = x;
    for (let attempt = 0; attempt < 24 && !next; attempt++) {
      const damped = Float64Array.from(gram);
      for (let i = 0; i < m; i++) damped[i * m + i] = (damped[i * m + i] as number) + lambda;
      const y = choleskySolve(damped, m, Float64Array.from(raw, (v) => -v));
      if (y) {
        moved = [...x];
        rows.forEach((row, i) => row.cols.forEach((col, k) => (moved[col] = (moved[col] as number) + (row.vals[k] as number) * (y[i] as number))));
        const trial = evaluate(constraints, vars, moved);
        if (trial && trial.worst < current.worst) next = trial;
      }
      if (!next) lambda *= 10;
    }
    if (!next) return undefined;
    x = moved;
    current = next;
    lambda = Math.max(lambda / 10, 1e-12);
  }
  return current && current.worst <= SOLVE_TOLERANCE_MM && keepsSizes(vars, x) ? x : undefined;
}

function dotLookups(a: JacobianRow, lookup: Map<number, number>): number {
  let sum = 0;
  a.cols.forEach((col, i) => {
    const w = lookup.get(col);
    if (w !== undefined) sum += w * (a.vals[i] as number);
  });
  return sum;
}

/** Lines keep a length above zero, circles and arcs a radius above zero. */
function keepsSizes(vars: SketchVariables, x: readonly number[]): boolean {
  return vars.entities.every((entity) => {
    const b = vars.base.get(entity.id) as number;
    if (entity.type === 'line') return Math.hypot((x[b + 2] as number) - (x[b] as number), (x[b + 3] as number) - (x[b + 1] as number)) > MIN_SIZE_MM;
    if (entity.type === 'circle' || entity.type === 'arc') return (x[b + 2] as number) > MIN_SIZE_MM;
    return true;
  });
}

export interface Analysis {
  /** Entity freedom minus the rank the constraints actually contribute. */
  slack: number;
  /** Constraint ids that removed no freedom when added in creation order. */
  redundant: Set<string>;
  /** Remaining freedom of every sketch point (0, 1 or 2), by point reference. */
  freedom: Map<string, 0 | 1 | 2>;
}

/** Rows below this size after elimination count as zero (every row is normalised to unit length first). */
const ZERO_ENTRY = 1e-9;

/**
 * A sparse echelon form built row by row: a row is independent when something is left of it after the
 * rows already in the space have been eliminated from it. Used for the rank of the constraint equations.
 */
class RowSpace {
  private readonly pivots = new Map<number, Map<number, number>>();

  /** A space that sees everything in `base` and keeps its own additions to itself. */
  constructor(private readonly base?: RowSpace) {}

  private pivot(column: number): Map<number, number> | undefined {
    return this.pivots.get(column) ?? this.base?.pivot(column);
  }

  /** Adds the row when independent of the rows already here; reports whether it was. */
  add(row: JacobianRow): boolean {
    const length = Math.hypot(...row.vals);
    if (length === 0) return false;
    const left = new Map<number, number>();
    row.cols.forEach((column, i) => left.set(column, (row.vals[i] as number) / length));
    for (;;) {
      let lead = Infinity;
      for (const [column, value] of left) {
        if (Math.abs(value) <= ZERO_ENTRY) left.delete(column);
        else if (column < lead) lead = column;
      }
      if (lead === Infinity) return false;
      const pivot = this.pivot(lead);
      if (!pivot) {
        const scale = left.get(lead) as number;
        this.pivots.set(lead, new Map([...left].map(([column, value]) => [column, value / scale])));
        return true;
      }
      const factor = left.get(lead) as number;
      for (const [column, value] of pivot) left.set(column, (left.get(column) ?? 0) - factor * value);
      left.delete(lead);
    }
  }
}

/** Solves nothing; reads the Jacobian at the current geometry to count slack, redundancy and point freedom. */
export function analyze(vars: SketchVariables, constraints: readonly SolverConstraint[]): Analysis {
  const total = vars.entities.reduce((sum, e) => sum + entityFreedom(e), 0);
  const redundant = new Set<string>();
  const space = new RowSpace();
  let rank = 0;
  for (const c of constraints) {
    const independent = (equations(c, vars, vars.values) ?? []).filter((eq) => space.add(eq.row)).length;
    rank += independent;
    if (independent === 0) redundant.add(c.id);
  }
  const freedom = new Map<string, 0 | 1 | 2>();
  for (const entity of vars.entities) {
    for (const ref of pointRefs(entity)) {
      const p = vars.point(ref, vars.values);
      if (!p) continue;
      const probe = new RowSpace(space);
      freedom.set(ref, [p.grad.dx, p.grad.dy].filter((vals) => probe.add({ cols: p.grad.vars, vals })).length as 0 | 1 | 2);
    }
  }
  return { slack: total - rank, redundant, freedom };
}

/** The references of the points an entity owns. */
export function pointRefs(entity: Entity): string[] {
  switch (entity.type) {
    case 'point':
      return [entity.id];
    case 'line':
      return [`${entity.id}.start`, `${entity.id}.end`];
    case 'circle':
      return [`${entity.id}.center`];
    case 'arc':
      return [`${entity.id}.center`, `${entity.id}.start`, `${entity.id}.end`];
  }
}
