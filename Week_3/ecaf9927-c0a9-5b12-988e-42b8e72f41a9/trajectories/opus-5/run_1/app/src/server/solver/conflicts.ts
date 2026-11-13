import { parsePointRef, solveSketch, ORIGIN_REF, type SolverConstraint, type SolverEntity } from './sketch.js';

function referencedEntityIds(constraint: SolverConstraint): string[] {
  return constraint.refs
    .filter((ref) => ref !== ORIGIN_REF)
    .map((ref) => parsePointRef(ref).entityId);
}

function referenceKey(constraint: SolverConstraint): string {
  return [...constraint.refs].sort().join('|');
}

/**
 * Two constraints share a reference when any of their references name the same entity or
 * the same point, or one names an entity and the other one of that entity's own points.
 * The origin never counts.
 */
function sharesReference(left: SolverConstraint, right: SolverConstraint): boolean {
  for (const a of left.refs) {
    if (a === ORIGIN_REF) continue;
    const first = parsePointRef(a);
    for (const b of right.refs) {
      if (b === ORIGIN_REF) continue;
      const second = parsePointRef(b);
      if (first.entityId !== second.entityId) continue;
      if (first.part === second.part || first.part === 'self' || second.part === 'self') return true;
    }
  }
  return false;
}

function impossibleTogether(
  candidate: SolverConstraint,
  existing: SolverConstraint,
  entities: SolverEntity[],
): boolean {
  const needed = new Set([...referencedEntityIds(candidate), ...referencedEntityIds(existing)]);
  const subset = entities.filter((entity) => needed.has(entity.id));
  return solveSketch(subset, [existing, candidate]) === null;
}

/**
 * The existing constraint a refused constraint is reported against: one on the same
 * references that alone makes it impossible, else the newest sharing a reference, else
 * the newest in the sketch.
 */
export function nameConflict(
  candidate: SolverConstraint,
  existing: SolverConstraint[],
  entities: SolverEntity[],
): SolverConstraint {
  const candidateKey = referenceKey(candidate);
  for (let i = existing.length - 1; i >= 0; i -= 1) {
    const other = existing[i] as SolverConstraint;
    if (referenceKey(other) !== candidateKey) continue;
    if (impossibleTogether(candidate, other, entities)) return other;
  }
  for (let i = existing.length - 1; i >= 0; i -= 1) {
    const other = existing[i] as SolverConstraint;
    if (sharesReference(candidate, other)) return other;
  }
  return existing[existing.length - 1] as SolverConstraint;
}
