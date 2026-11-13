import type { ConstraintKind, Entity, Tolerance } from '../../shared/api';
import { isDimension } from '../../shared/constraint-rules';
import { SketchVariables, analyze, components, solve, type Analysis, type SolverConstraint } from './solver';

/** A stored constraint: what the solver needs plus the label and tolerance the member sees. */
export interface StoredConstraint extends SolverConstraint {
  label: string;
  tolerance?: Tolerance;
}

/** The first line of the conflict rule: an existing constraint on the same references that makes the new one impossible alone. */
function directConflict(existing: readonly StoredConstraint[], candidate: SolverConstraint): StoredConstraint | undefined {
  const sameRefs = (a: readonly string[], b: readonly string[]) =>
    a.length === b.length && [...a].sort().join('|') === [...b].sort().join('|');
  const opposite: Partial<Record<ConstraintKind, ConstraintKind>> = {
    horizontal: 'vertical',
    vertical: 'horizontal',
    parallel: 'perpendicular',
    perpendicular: 'parallel',
  };
  const diameterOf = (c: SolverConstraint) => (c.kind === 'radius' ? 2 : 1) * (c.value ?? 0);
  const differs = (a: number, b: number) => Math.abs(a - b) > 1e-9;
  return [...existing].reverse().find((c) => {
    if (!sameRefs(c.refs, candidate.refs)) return false;
    if (opposite[candidate.kind] === c.kind) return true;
    if (c.kind === candidate.kind && isDimension(c.kind) && c.kind !== 'diameter' && c.kind !== 'radius') {
      return differs(c.value ?? 0, candidate.value ?? 0);
    }
    const round = (k: ConstraintKind) => k === 'diameter' || k === 'radius';
    return round(c.kind) && round(candidate.kind) && differs(diameterOf(c), diameterOf(candidate));
  });
}

/** Two references are shared when equal, or when one is an entity and the other one of its own points. The origin never counts. */
function shares(a: string, b: string): boolean {
  if (a === 'origin' || b === 'origin') return false;
  const entityOf = (ref: string) => ref.split('.')[0];
  return a === b || (!a.includes('.') && a === entityOf(b)) || (!b.includes('.') && b === entityOf(a));
}

/** Names the existing constraint a refused one conflicts with: same references, else latest sharing a reference, else latest. */
export function conflictingConstraint(existing: readonly StoredConstraint[], candidate: SolverConstraint): StoredConstraint | undefined {
  return (
    directConflict(existing, candidate) ??
    [...existing].reverse().find((c) => c.refs.some((a) => candidate.refs.some((b) => shares(a, b)))) ??
    existing[existing.length - 1]
  );
}

/** Fills in what a constraint remembers from the geometry it is placed on: a Fix's anchor and the direction of a distance. */
export function anchored(candidate: SolverConstraint, entities: readonly Entity[]): SolverConstraint {
  const vars = new SketchVariables(entities);
  const at = (ref: string) => vars.point(ref, vars.values);
  if (candidate.kind === 'fix') {
    const p = at(candidate.refs[0] ?? '');
    return p ? { ...candidate, anchor: { x: p.x, y: p.y } } : candidate;
  }
  if (candidate.kind === 'horizontal_distance' || candidate.kind === 'vertical_distance') {
    const p = at(candidate.refs[0] ?? '');
    const q = at(candidate.refs[1] ?? '');
    if (!p || !q) return candidate;
    const separation = candidate.kind === 'horizontal_distance' ? q.x - p.x : q.y - p.y;
    return { ...candidate, sign: separation < 0 ? -1 : 1 };
  }
  return candidate;
}

/** Solves the component the changed constraint belongs to; undefined when nothing fits. */
export function solveWith(
  entities: readonly Entity[],
  constraints: readonly SolverConstraint[],
  changedId: string,
): Entity[] | undefined {
  const group = components(constraints).find((g) => g.some((c) => c.id === changedId)) ?? [];
  const vars = new SketchVariables(entities);
  const solved = solve(group, vars);
  return solved ? vars.apply(solved) : undefined;
}

export function analyzeSketch(entities: readonly Entity[], constraints: readonly SolverConstraint[]): Analysis {
  return analyze(new SketchVariables(entities), constraints);
}
