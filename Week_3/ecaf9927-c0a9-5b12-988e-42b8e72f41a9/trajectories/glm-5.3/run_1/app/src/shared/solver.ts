import type { Constraint, ConstraintKind, EntityType, SketchEntity } from "./types.js";

/**
 * Sketch solving. The single place that decides slack, each constraint's rank
 * contribution and each point's remaining freedom. Constraint residuals are
 * differentiated numerically and the Jacobian's rank is measured at the
 * solved geometry.
 */

export interface PointRef {
  ref: string;
  name: string;
}

const ZERO_LEN = 1e-9;
export const SOLVE_TOL = 1e-6;

/** Every point of every entity, in creation order. */
export function pointsOf(entities: SketchEntity[]): PointRef[] {
  const pts: PointRef[] = [];
  for (const e of entities) {
    if (e.type === "point") pts.push({ ref: e.id, name: e.label });
    if (e.type === "line") {
      pts.push({ ref: `${e.id}.start`, name: `${e.label} start` });
      pts.push({ ref: `${e.id}.end`, name: `${e.label} end` });
    }
    if (e.type === "circle" || e.type === "arc") {
      pts.push({ ref: `${e.id}.center`, name: `${e.label} centre` });
    }
  }
  return pts;
}

/** The freedom an entity brings to a sketch. */
export function entityFreedom(entity: SketchEntity): number {
  switch (entity.type) {
    case "point":
      return 2;
    case "line":
      return 4;
    case "circle":
      return 3;
    case "arc":
      return 5;
  }
}

function paramsOf(e: SketchEntity): number[] {
  switch (e.type) {
    case "point":
      return [e.x, e.y];
    case "line":
      return [e.start.x, e.start.y, e.end.x, e.end.y];
    case "circle":
      return [e.center.x, e.center.y, e.radius];
    case "arc":
      return [e.center.x, e.center.y, e.radius, e.start_angle_deg, e.end_angle_deg];
  }
}

function applyParams(e: SketchEntity, values: number[]): void {
  switch (e.type) {
    case "point":
      e.x = values[0]!;
      e.y = values[1]!;
      break;
    case "line":
      e.start = { x: values[0]!, y: values[1]! };
      e.end = { x: values[2]!, y: values[3]! };
      break;
    case "circle":
      e.center = { x: values[0]!, y: values[1]! };
      e.radius = values[2]!;
      break;
    case "arc":
      e.center = { x: values[0]!, y: values[1]! };
      e.radius = values[2]!;
      e.start_angle_deg = values[3]!;
      e.end_angle_deg = values[4]!;
      break;
  }
}

interface ParamLayout {
  entities: SketchEntity[];
  offsets: Map<string, number>;
  dims: Map<string, number>;
  size: number;
}

function layout(entities: SketchEntity[]): ParamLayout {
  const offsets = new Map<string, number>();
  const dims = new Map<string, number>();
  let size = 0;
  for (const e of entities) {
    offsets.set(e.id, size);
    dims.set(e.id, entityFreedom(e));
    size += dims.get(e.id)!;
  }
  return { entities, offsets, dims, size };
}

function currentParams(l: ParamLayout): number[] {
  const out: number[] = [];
  for (const e of l.entities) out.push(...paramsOf(e));
  return out;
}

function writeParams(l: ParamLayout, values: number[]): void {
  let i = 0;
  for (const e of l.entities) {
    const d = l.dims.get(e.id)!;
    applyParams(e, values.slice(i, i + d));
    i += d;
  }
}

function readPoint(l: ParamLayout, values: number[], ref: string): { x: number; y: number } | null {
  if (ref === "origin") return { x: 0, y: 0 };
  const dot = ref.lastIndexOf(".");
  if (dot === -1) {
    const e = l.entities.find((x) => x.id === ref);
    if (!e || e.type !== "point") return null;
    const off = l.offsets.get(e.id)!;
    return { x: values[off]!, y: values[off + 1]! };
  }
  const eid = ref.slice(0, dot);
  const part = ref.slice(dot + 1);
  const e = l.entities.find((x) => x.id === eid);
  if (!e) return null;
  const off = l.offsets.get(e.id)!;
  if (e.type === "line") {
    if (part === "start") return { x: values[off]!, y: values[off + 1]! };
    if (part === "end") return { x: values[off + 2]!, y: values[off + 3]! };
    return null;
  }
  if (e.type === "circle" || e.type === "arc") {
    if (part === "center") return { x: values[off]!, y: values[off + 1]! };
    return null;
  }
  return null;
}

/** One constraint instance with everything needed to build its residuals. */
export interface SolverConstraint {
  kind: ConstraintKind;
  refs: string[];
  value_mm?: number;
  /** Point positions captured when a fix constraint was created. */
  fixTargets: Map<string, { x: number; y: number }>;
}

interface GeometryView {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  radius: number;
  center: { x: number; y: number };
}

function readGeometry(l: ParamLayout, values: number[], ref: string): GeometryView | null {
  const eid = ref.includes(".") ? ref.slice(0, ref.lastIndexOf(".")) : ref;
  const e = l.entities.find((x) => x.id === eid);
  if (!e) return null;
  const off = l.offsets.get(e.id)!;
  switch (e.type) {
    case "point":
      return { x1: values[off]!, y1: values[off + 1]!, x2: values[off]!, y2: values[off + 1]!, radius: 0, center: { x: values[off]!, y: values[off + 1]! } };
    case "line":
      return {
        x1: values[off]!, y1: values[off + 1]!, x2: values[off + 2]!, y2: values[off + 3]!,
        radius: 0, center: { x: (values[off]! + values[off + 2]!) / 2, y: (values[off + 1]! + values[off + 3]!) / 2 }
      };
    case "circle":
    case "arc":
      return { x1: values[off]!, y1: values[off + 1]!, x2: values[off]!, y2: values[off + 1]!, radius: values[off + 2]!, center: { x: values[off]!, y: values[off + 1]! } };
  }
}

function entityIs(l: ParamLayout, ref: string, type: EntityType): boolean {
  const eid = ref.includes(".") ? ref.slice(0, ref.lastIndexOf(".")) : ref;
  const e = l.entities.find((x) => x.id === eid);
  return e?.type === type;
}

export function residualsOf(l: ParamLayout, values: number[], c: SolverConstraint): number[] {
  const point = (ref: string) => readPoint(l, values, ref);
  const geo = (ref: string) => readGeometry(l, values, ref);
  const isLine = (ref: string) => entityIs(l, ref, "line");
  const isRound = (ref: string) => entityIs(l, ref, "circle") || entityIs(l, ref, "arc");
  const v = c.value_mm ?? 0;
  switch (c.kind) {
    case "coincident": {
      const p = point(c.refs[0]!);
      const q = point(c.refs[1]!);
      if (!p || !q) return [];
      return [p.x - q.x, p.y - q.y];
    }
    case "horizontal": {
      const g = geo(c.refs[0]!);
      if (g && isLine(c.refs[0]!)) return [g.y1 - g.y2];
      return [];
    }
    case "vertical": {
      const g = geo(c.refs[0]!);
      if (g && isLine(c.refs[0]!)) return [g.x1 - g.x2];
      return [];
    }
    case "parallel": {
      const a = geo(c.refs[0]!);
      const b = geo(c.refs[1]!);
      if (a && b && isLine(c.refs[0]!) && isLine(c.refs[1]!))
        return [(a.x2 - a.x1) * (b.y2 - b.y1) - (a.y2 - a.y1) * (b.x2 - b.x1)];
      return [];
    }
    case "perpendicular": {
      const a = geo(c.refs[0]!);
      const b = geo(c.refs[1]!);
      if (a && b && isLine(c.refs[0]!) && isLine(c.refs[1]!))
        return [(a.x2 - a.x1) * (b.x2 - b.x1) + (a.y2 - a.y1) * (b.y2 - b.y1)];
      return [];
    }
    case "equal": {
      const a = geo(c.refs[0]!);
      const b = geo(c.refs[1]!);
      if (!a || !b) return [];
      if (isLine(c.refs[0]!) && isLine(c.refs[1]!))
        return [Math.hypot(a.x2 - a.x1, a.y2 - a.y1) - Math.hypot(b.x2 - b.x1, b.y2 - b.y1)];
      if (isRound(c.refs[0]!) && isRound(c.refs[1]!)) return [a.radius - b.radius];
      return [];
    }
    case "fix": {
      const p = point(c.refs[0]!);
      const t = c.fixTargets.get(c.refs[0]!);
      if (!p || !t) return [];
      return [p.x - t.x, p.y - t.y];
    }
    case "distance": {
      if (c.refs.length === 1) {
        const g = geo(c.refs[0]!);
        if (g && isLine(c.refs[0]!)) return [Math.hypot(g.x2 - g.x1, g.y2 - g.y1) - v];
        return [];
      }
      const p = point(c.refs[0]!);
      const q = point(c.refs[1]!);
      if (!p || !q) return [];
      return [Math.hypot(p.x - q.x, p.y - q.y) - v];
    }
    case "horizontal_distance": {
      const p = point(c.refs[0]!);
      const q = point(c.refs[1]!);
      if (!p || !q) return [];
      return [Math.abs(p.x - q.x) - v];
    }
    case "vertical_distance": {
      const p = point(c.refs[0]!);
      const q = point(c.refs[1]!);
      if (!p || !q) return [];
      return [Math.abs(p.y - q.y) - v];
    }
    case "diameter": {
      const g = geo(c.refs[0]!);
      if (g && isRound(c.refs[0]!)) return [2 * g.radius - v];
      return [];
    }
    case "radius": {
      const g = geo(c.refs[0]!);
      if (g && isRound(c.refs[0]!)) return [g.radius - v];
      return [];
    }
  }
}

const H = 1e-7;

/** Numeric Jacobian of every constraint's residuals over the parameter vector. */
function jacobian(
  l: ParamLayout,
  values: number[],
  constraints: SolverConstraint[]
): { rows: number[][]; rowOwner: number[] } {
  const rows: number[][] = [];
  const rowOwner: number[] = [];
  for (let ci = 0; ci < constraints.length; ci++) {
    const c = constraints[ci]!;
    const r0 = residualsOf(l, values, c);
    for (let k = 0; k < r0.length; k++) {
      const row: number[] = new Array(l.size).fill(0);
      for (let d = 0; d < l.size; d++) {
        const bumped = values.slice();
        bumped[d] = (bumped[d] ?? 0) + H;
        const r1 = residualsOf(l, bumped, c);
        row[d] = r1[k] !== undefined ? (r1[k]! - r0[k]!) / H : 0;
      }
      rows.push(row);
      rowOwner.push(ci);
    }
  }
  return { rows, rowOwner };
}

/** Rank of a matrix, by modified Gram-Schmidt on its rows with a threshold. */
export function rankOf(matrix: number[][], threshold: number): number {
  const ortho: number[][] = [];
  let rank = 0;
  for (const raw of matrix) {
    let w = raw.slice();
    for (const u of ortho) {
      const dot = u.reduce((s, x, i) => s + x * w[i]!, 0);
      w = w.map((x, i) => x - dot * u[i]!);
    }
    const norm = Math.hypot(...w);
    if (norm > threshold) {
      ortho.push(w.map((x) => x / norm));
      rank++;
    }
  }
  return rank;
}

function solveLeastNorm(rows: number[][], residuals: number[]): number[] {
  const n = rows[0]?.length ?? 0;
  if (n === 0) return [];
  const jtj = Array.from({ length: n }, () => new Array(n).fill(0));
  const jtr = new Array(n).fill(0);
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    for (let a = 0; a < n; a++) {
      jtr[a] += row[a]! * -residuals[i]!;
      for (let b = 0; b < n; b++) jtj[a]![b] += row[a]! * row[b]!;
    }
  }
  const lambda = 1e-9;
  for (let a = 0; a < n; a++) jtj[a]![a] += lambda;
  const aug = jtj.map((r, i) => [...r, jtr[i]!]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(aug[r]![col]!) > Math.abs(aug[piv]![col]!)) piv = r;
    [aug[col], aug[piv]] = [aug[piv]!, aug[col]!];
    const d = aug[col]![col]!;
    if (Math.abs(d) < 1e-13) continue;
    for (let c = col; c <= n; c++) aug[col]![c] = aug[col]![c]! / d;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = aug[r]![col]!;
      if (f === 0) continue;
      for (let c = col; c <= n; c++) aug[r]![c] = aug[r]![c]! - f * aug[col]![c]!;
    }
  }
  return aug.map((r) => r[n] ?? 0);
}

function validGeometry(l: ParamLayout, values: number[]): boolean {
  let i = 0;
  for (const e of l.entities) {
    const d = l.dims.get(e.id)!;
    const slice = values.slice(i, i + d);
    if (e.type === "line" && Math.hypot(slice[2]! - slice[0]!, slice[3]! - slice[1]!) <= ZERO_LEN) return false;
    if ((e.type === "circle" || e.type === "arc") && slice[2]! <= ZERO_LEN) return false;
    if (!slice.every((v) => Number.isFinite(v))) return false;
    i += d;
  }
  return true;
}

/** Move the geometry as little as possible to satisfy every constraint. */
export function solveConstraints(
  entities: SketchEntity[],
  constraints: SolverConstraint[]
): { ok: boolean } {
  const l = layout(entities);
  let values = currentParams(l);
  if (l.size === 0) return { ok: true };
  for (let iter = 0; iter < 60; iter++) {
    const res: number[] = [];
    for (const c of constraints) res.push(...residualsOf(l, values, c));
    if (res.every((r) => Math.abs(r) < SOLVE_TOL * 0.5)) break;
    const { rows } = jacobian(l, values, constraints);
    const delta = solveLeastNorm(rows, res);
    const capped = delta.map((d) => Math.max(-1000, Math.min(1000, d)));
    values = values.map((v, i) => v + capped[i]!);
    if (!validGeometry(l, values)) return { ok: false };
  }
  const ok = validGeometry(l, values) && maxResidual(l, values, constraints) < SOLVE_TOL;
  if (ok) writeParams(l, values);
  return { ok };
}

function maxResidual(l: ParamLayout, values: number[], constraints: SolverConstraint[]): number {
  let max = 0;
  for (const c of constraints) {
    for (const r of residualsOf(l, values, c)) max = Math.max(max, Math.abs(r));
  }
  return max;
}

/**
 * Slack, per-constraint rank contribution and per-point freedom, computed
 * at the current (solved) geometry.
 */
export function analyze(entities: SketchEntity[], constraints: SolverConstraint[]): {
  slack: number;
  ranks: number[];
  redundant: boolean[];
  pointFreedoms: Map<string, number>;
  nullBasis: number[][];
} {
  const l = layout(entities);
  const values = currentParams(l);
  const { rows, rowOwner } = jacobian(l, values, constraints);
  const ranks: number[] = constraints.map(() => 0);
  let seen = 0;
  for (let ci = 0; ci < constraints.length; ci++) {
    const subset: number[][] = [];
    for (let i = 0; i < rows.length; i++) if (rowOwner[i]! <= ci) subset.push(rows[i]!);
    const r = rankOf(subset, 1e-6);
    ranks[ci] = r - seen;
    seen = r;
  }
  const slack = Math.max(0, l.size - seen);
  const nullBasis = nullSpaceBasis(rows, l.size, seen);
  const pointFreedoms = new Map<string, number>();
  for (const p of pointsOf(entities)) {
    const dims = pointDims(l, p.ref);
    if (!dims) continue;
    const sub = nullBasis.map((vec) => [vec[dims[0]]!, vec[dims[1]]!]);
    pointFreedoms.set(p.ref, rankOf(sub, 1e-5));
  }
  return { slack, ranks, redundant: ranks.map((r) => r === 0), pointFreedoms, nullBasis };
}

function pointDims(l: ParamLayout, ref: string): [number, number] | null {
  if (ref === "origin") return null;
  const dot = ref.lastIndexOf(".");
  if (dot === -1) {
    const e = l.entities.find((x) => x.id === ref);
    if (!e || e.type !== "point") return null;
    const off = l.offsets.get(e.id)!;
    return [off, off + 1];
  }
  const eid = ref.slice(0, dot);
  const part = ref.slice(dot + 1);
  const e = l.entities.find((x) => x.id === eid);
  if (!e) return null;
  const off = l.offsets.get(e.id)!;
  if (e.type === "line") {
    if (part === "start") return [off, off + 1];
    if (part === "end") return [off + 2, off + 3];
    return null;
  }
  if (e.type === "circle" || e.type === "arc") {
    if (part === "center") return [off, off + 1];
    return null;
  }
  return null;
}

/** An orthonormal basis of the null space of the given rows. */
function nullSpaceBasis(rows: number[][], n: number, rank: number): number[][] {
  if (n === 0) return [];
  const nullDim = n - rank;
  if (nullDim <= 0) return [];
  const rowSpace = orthonormalize(rows.map((r) => r.slice()));
  const basis: number[][] = [];
  const tryVector = (v: number[]): boolean => {
    let w = v.slice();
    for (const u of rowSpace) {
      const dot = u.reduce((s, x, i) => s + x * w[i]!, 0);
      w = w.map((x, i) => x - dot * u[i]!);
    }
    for (const b of basis) {
      const dot = b.reduce((s, x, i) => s + x * w[i]!, 0);
      w = w.map((x, i) => x - dot * b[i]!);
    }
    const norm = Math.hypot(...w);
    if (norm > 1e-7) {
      basis.push(w.map((x) => x / norm));
      return true;
    }
    return false;
  };
  for (let d = 0; d < n && basis.length < nullDim; d++) {
    const v = new Array(n).fill(0);
    v[d] = 1;
    tryVector(v);
  }
  for (let attempt = 0; attempt < 40 && basis.length < nullDim; attempt++) {
    const probe = Array.from({ length: n }, () => Math.random() * 2 - 1);
    tryVector(probe);
  }
  return basis;
}

function orthonormalize(vectors: number[][]): number[][] {
  const out: number[][] = [];
  for (const v of vectors) {
    let w = v.slice();
    for (const u of out) {
      const dot = u.reduce((s, x, i) => s + x * w[i]!, 0);
      w = w.map((x, i) => x - dot * u[i]!);
    }
    const norm = Math.hypot(...w);
    if (norm > 1e-9) out.push(w.map((x) => x / norm));
  }
  return out;
}

export function solverConstraintOf(
  c: Constraint,
  fixTargets: Map<string, { x: number; y: number }>
): SolverConstraint {
  return { kind: c.kind, refs: c.refs, value_mm: c.value_mm, fixTargets };
}
