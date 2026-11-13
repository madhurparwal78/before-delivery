import type { ConstraintKind, Entity } from './api';
import { DIMENSION_KINDS } from './api';

export const CONSTRAINT_WORDS: Record<ConstraintKind, string> = {
  coincident: 'Coincident',
  horizontal: 'Horizontal',
  vertical: 'Vertical',
  parallel: 'Parallel',
  perpendicular: 'Perpendicular',
  equal: 'Equal',
  fix: 'Fix',
  distance: 'Distance',
  horizontal_distance: 'Horizontal distance',
  vertical_distance: 'Vertical distance',
  diameter: 'Diameter',
  radius: 'Radius',
};

export const isDimension = (kind: ConstraintKind): boolean => DIMENSION_KINDS.includes(kind);

type RefClass = 'point' | 'line' | 'circle' | 'arc';

function classify(ref: string, byId: ReadonlyMap<string, Entity>): RefClass | undefined {
  if (ref === 'origin') return 'point';
  const [id = '', part] = ref.split('.');
  const entity = byId.get(id);
  if (!entity) return undefined;
  if (part === undefined) return entity.type === 'point' ? 'point' : entity.type;
  if (entity.type === 'line' && (part === 'start' || part === 'end')) return 'point';
  if (entity.type === 'circle' && part === 'center') return 'point';
  if (entity.type === 'arc' && (part === 'center' || part === 'start' || part === 'end')) return 'point';
  return undefined;
}

/** Whether the references fit the constraint kind (the "Constraint references" table). */
export function refsFit(kind: ConstraintKind, refs: readonly string[], entities: readonly Entity[]): boolean {
  const byId = new Map(entities.map((e) => [e.id, e]));
  const classes = refs.map((ref) => classify(ref, byId));
  const distinct = new Set(refs).size === refs.length;
  const round = (c: RefClass | undefined) => c === 'circle' || c === 'arc';
  switch (kind) {
    case 'coincident':
    case 'horizontal_distance':
    case 'vertical_distance':
      return refs.length === 2 && distinct && classes.every((c) => c === 'point');
    case 'fix':
      return refs.length === 1 && classes[0] === 'point';
    case 'horizontal':
    case 'vertical':
      return refs.length === 1 && classes[0] === 'line';
    case 'parallel':
    case 'perpendicular':
      return refs.length === 2 && distinct && classes.every((c) => c === 'line');
    case 'equal':
      return refs.length === 2 && distinct && (classes.every((c) => c === 'line') || classes.every(round));
    case 'distance':
      return (refs.length === 1 && classes[0] === 'line') || (refs.length === 2 && distinct && classes.every((c) => c === 'point'));
    case 'diameter':
    case 'radius':
      return refs.length === 1 && round(classes[0]);
  }
}

