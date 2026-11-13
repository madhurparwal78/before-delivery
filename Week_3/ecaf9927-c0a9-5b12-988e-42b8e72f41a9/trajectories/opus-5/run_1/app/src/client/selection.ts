import type { ConstraintKind, Sketch } from '../shared/api.js';

export type RefKind = 'point' | 'line' | 'circle' | 'arc';

export function refKind(sketch: Sketch, ref: string): RefKind | null {
  if (ref === 'origin') return 'point';
  if (/\.(start|end|center)$/.test(ref)) return 'point';
  const entity = sketch.entities.find((candidate) => candidate.id === ref);
  if (!entity) return null;
  return entity.type === 'point' ? 'point' : entity.type;
}

function kinds(sketch: Sketch, selection: string[]): RefKind[] {
  return selection
    .map((ref) => refKind(sketch, ref))
    .filter((kind): kind is RefKind => kind !== null);
}

/** Which dimension a Dimension press means for the current selection. */
export function dimensionKindFor(sketch: Sketch, selection: string[]): ConstraintKind | null {
  const picked = kinds(sketch, selection);
  if (picked.length === 1 && picked[0] === 'line') return 'distance';
  if (picked.length === 1 && picked[0] === 'circle') return 'diameter';
  if (picked.length === 1 && picked[0] === 'arc') return 'radius';
  if (picked.length === 2 && picked.every((kind) => kind === 'point')) return 'distance';
  return null;
}

export function canApply(sketch: Sketch, selection: string[], kind: ConstraintKind): boolean {
  const picked = kinds(sketch, selection);
  const allPoints = picked.length > 0 && picked.every((item) => item === 'point');
  const allLines = picked.length > 0 && picked.every((item) => item === 'line');
  const allRound = picked.length > 0 && picked.every((item) => item === 'circle' || item === 'arc');
  switch (kind) {
    case 'coincident':
      return picked.length === 2 && allPoints;
    case 'horizontal':
    case 'vertical':
      return picked.length === 1 && allLines;
    case 'parallel':
    case 'perpendicular':
      return picked.length === 2 && allLines;
    case 'equal':
      return picked.length === 2 && (allLines || allRound);
    case 'fix':
      return picked.length === 1 && allPoints;
    case 'horizontal_distance':
    case 'vertical_distance':
      return picked.length === 2 && allPoints;
    case 'distance':
    case 'diameter':
    case 'radius':
      return dimensionKindFor(sketch, selection) !== null;
  }
}
