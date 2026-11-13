import { randomBytes } from "node:crypto";
import type { Constraint, ConstraintKind, SketchEntity, Tolerance } from "../shared/types.js";
import {
  analyze,
  pointsOf,
  solveConstraints,
  solverConstraintOf,
  type SolverConstraint
} from "../shared/solver.js";

/**
 * The single place that decides a sketch's slack, redundancy and the
 * conflict-naming rule.
 */

export interface StoredEntity {
  id: string;
  type: SketchEntity["type"];
  label: string;
  geometry: SketchEntity;
}

export interface StoredConstraint {
  id: string;
  kind: ConstraintKind;
  label: string;
  refs: string[];
  value_mm?: number;
  tolerance?: Tolerance | null;
  redundant: boolean;
  fixTargets: Map<string, { x: number; y: number }>;
  createdAt: Date;
}

export interface SketchAnalysis {
  slack: number;
  fullyHeld: boolean;
  redundant: Map<string, boolean>;
  pointFreedoms: Map<string, number>;
}

export function solverConstraints(stored: StoredConstraint[]): SolverConstraint[] {
  return stored
    .slice()
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    .map((c) => solverConstraintOf(toConstraint(c), c.fixTargets));
}

function toConstraint(c: StoredConstraint): Constraint {
  return {
    id: c.id,
    label: c.label,
    kind: c.kind,
    refs: c.refs,
    value_mm: c.value_mm,
    tolerance: c.tolerance ?? null,
    redundant: c.redundant
  };
}

/** Slack and per-point freedom at the current geometry. */
export function analyzeSketch(
  entities: SketchEntity[],
  stored: StoredConstraint[]
): SketchAnalysis {
  const result = analyze(entities, solverConstraints(stored));
  const redundant = new Map<string, boolean>();
  stored.forEach((c, i) => redundant.set(c.id, result.redundant[i] ?? false));
  return {
    slack: result.slack,
    fullyHeld: result.slack === 0,
    redundant,
    pointFreedoms: result.pointFreedoms
  };
}

/** Move the geometry as little as possible so every constraint holds. */
export function solveSketch(entities: SketchEntity[], stored: StoredConstraint[]): boolean {
  return solveConstraints(entities, solverConstraints(stored)).ok;
}

export function sketchPoints(entities: SketchEntity[], analysis: SketchAnalysis): {
  ref: string;
  name: string;
  x: number;
  y: number;
  freedom: number;
}[] {
  return pointsOf(entities).map((p) => {
    const position = pointPosition(entities, p.ref);
    return {
      ref: p.ref,
      name: p.name,
      x: position?.x ?? 0,
      y: position?.y ?? 0,
      freedom: analysis.pointFreedoms.get(p.ref) ?? 0
    };
  });
}

export function pointPosition(entities: SketchEntity[], ref: string): { x: number; y: number } | null {
  if (ref === "origin") return { x: 0, y: 0 };
  const dot = ref.lastIndexOf(".");
  if (dot === -1) {
    const e = entities.find((x) => x.id === ref);
    return e && e.type === "point" ? { x: e.x, y: e.y } : null;
  }
  const eid = ref.slice(0, dot);
  const part = ref.slice(dot + 1);
  const e = entities.find((x) => x.id === eid);
  if (!e) return null;
  if (e.type === "line") {
    if (part === "start") return { x: e.start.x, y: e.start.y };
    if (part === "end") return { x: e.end.x, y: e.end.y };
  }
  if ((e.type === "circle" || e.type === "arc") && part === "center") {
    return { x: e.center.x, y: e.center.y };
  }
  return null;
}

/**
 * The conflict-naming rule: an existing constraint on the same references
 * that makes the new one impossible on its own; else the most recently
 * added constraint sharing a reference; else the most recent constraint.
 */
export function nameConflict(
  candidate: { kind: ConstraintKind; refs: string[]; value_mm?: number },
  existing: StoredConstraint[],
  entities: SketchEntity[]
): { id: string; label: string } | null {
  const sameRefs = existing.filter((c) => sameReferenceSet(candidate, c));
  for (const c of sameRefs) {
    if (incompatibleAlone(candidate, c)) return { id: c.id, label: c.label };
  }
  const shares = existing.filter((c) => sharesReference(candidate, c, entities));
  if (shares.length > 0) {
    const latest = shares.reduce((a, b) => (a.createdAt > b.createdAt ? a : b));
    return { id: latest.id, label: latest.label };
  }
  if (existing.length > 0) {
    const latest = existing.reduce((a, b) => (a.createdAt > b.createdAt ? a : b));
    return { id: latest.id, label: latest.label };
  }
  return null;
}

function sameReferenceSet(
  a: { kind: ConstraintKind; refs: string[]; value_mm?: number },
  b: StoredConstraint
): boolean {
  return a.kind === b.kind && a.refs.length === b.refs.length && a.refs.every((r, i) => r === b.refs[i]);
}

/** Kinds that fix the same quantity to possibly different values. */
function incompatibleAlone(
  a: { kind: ConstraintKind; refs: string[]; value_mm?: number },
  b: StoredConstraint
): boolean {
  const fixing: ConstraintKind[] = ["horizontal", "vertical", "distance", "diameter", "radius", "horizontal_distance", "vertical_distance"];
  if (!fixing.includes(a.kind)) {
    if (a.kind === "parallel" && b.kind === "perpendicular") return true;
    if (a.kind === "perpendicular" && b.kind === "parallel") return true;
    if (a.kind === "horizontal" && b.kind === "vertical") return true;
    if (a.kind === "vertical" && b.kind === "horizontal") return true;
    return false;
  }
  if (a.kind !== b.kind) return false;
  const av = a.value_mm ?? 0;
  const bv = b.value_mm ?? 0;
  return Math.abs(av - bv) > 1e-9;
}

/** Two constraints share a reference when any reference overlaps, counting
 * an entity and its own points as shared. The origin never counts. */
function sharesReference(
  a: { refs: string[] },
  b: { refs: string[] },
  entities: SketchEntity[]
): boolean {
  const entityIdOf = (ref: string): string | null => {
    const dot = ref.lastIndexOf(".");
    if (dot === -1) {
      return entities.some((e) => e.id === ref && e.type !== "point") ? ref : null;
    }
    return ref.slice(0, dot);
  };
  for (const ra of a.refs) {
    if (ra === "origin") continue;
    const ea = entityIdOf(ra);
    for (const rb of b.refs) {
      if (rb === "origin") continue;
      if (ra === rb) return true;
      const eb = entityIdOf(rb);
      if (ea && eb && ea === eb) return true;
    }
  }
  return false;
}

/** Constraint kinds and their reference rules. */
export function refsValidFor(
  kind: ConstraintKind,
  refs: string[],
  entities: SketchEntity[]
): boolean {
  const entity = (id: string) => entities.find((e) => e.id === id);
  const isPointRef = (ref: string): boolean => {
    if (ref === "origin") return true;
    const pos = pointPosition(entities, ref);
    return pos !== null;
  };
  const isLine = (ref: string) => entity(ref)?.type === "line";
  const isRound = (ref: string) => {
    const t = entity(ref)?.type;
    return t === "circle" || t === "arc";
  };
  switch (kind) {
    case "coincident":
      return refs.length === 2 && refs.every(isPointRef);
    case "horizontal":
    case "vertical":
      return refs.length === 1 && isLine(refs[0]!);
    case "parallel":
    case "perpendicular":
      return refs.length === 2 && refs.every(isLine);
    case "equal":
      return (
        refs.length === 2 &&
        ((refs.every(isLine) || refs.every((r) => isRound(r) && entity(r)?.type !== undefined)) as boolean)
      );
    case "fix":
      return refs.length === 1 && isPointRef(refs[0]!);
    case "distance":
      if (refs.length === 1) return isLine(refs[0]!);
      return refs.length === 2 && refs.every(isPointRef);
    case "horizontal_distance":
    case "vertical_distance":
      return refs.length === 2 && refs.every(isPointRef);
    case "diameter":
    case "radius":
      return refs.length === 1 && isRound(refs[0]!);
  }
}

export function needsValue(kind: ConstraintKind): boolean {
  return (
    kind === "distance" ||
    kind === "horizontal_distance" ||
    kind === "vertical_distance" ||
    kind === "diameter" ||
    kind === "radius"
  );
}

export function labelWord(kind: ConstraintKind): string {
  switch (kind) {
    case "coincident":
      return "Coincident";
    case "horizontal":
      return "Horizontal";
    case "vertical":
      return "Vertical";
    case "parallel":
      return "Parallel";
    case "perpendicular":
      return "Perpendicular";
    case "equal":
      return "Equal";
    case "fix":
      return "Fix";
    case "distance":
      return "Distance";
    case "horizontal_distance":
      return "Horizontal distance";
    case "vertical_distance":
      return "Vertical distance";
    case "diameter":
      return "Diameter";
    case "radius":
      return "Radius";
  }
}

export function entityLabelWord(type: SketchEntity["type"]): string {
  switch (type) {
    case "point":
      return "Point";
    case "line":
      return "Line";
    case "circle":
      return "Circle";
    case "arc":
      return "Arc";
  }
}

export function newId(): string {
  return randomBytes(12).toString("hex");
}

/** The next unused number for a kind; numbers are never reused. */
export function nextNumber(counters: Map<string, number>, kind: string): number {
  const next = (counters.get(kind) ?? 0) + 1;
  counters.set(kind, next);
  return next;
}

/** The label a refused constraint would have carried. */
export function refusedLabel(counters: Map<string, number>, kind: ConstraintKind): string {
  return `${labelWord(kind)} ${(counters.get(kind) ?? 0) + 1}`;
}


