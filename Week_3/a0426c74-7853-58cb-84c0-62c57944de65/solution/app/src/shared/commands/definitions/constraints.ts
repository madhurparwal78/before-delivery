// CONSTRAIN and PARAM: geometric and dimensional constraints, and the named parameters their expressions use.
import * as copy from '../../copy.ts';
import { measureDistance, SNAP_APERTURE_PX, type SceneEntity } from '../../geometry/index.ts';
import { CONSTRAINT_KINDS, type ConstraintKind, type ConstraintRef, type Point } from '../../types.ts';
import { pointStage, textStage, wordStage } from '../builders.ts';
import type { CommandEnv } from '../env.ts';
import { isType, pickOne, type Picked } from '../picking.ts';
import { finish, next, PROMPTS, stay, type Definition, type OpSpec, type Stage, type Step } from '../stages.ts';

const constraint = (kind: ConstraintKind, refs: ConstraintRef[], expression?: string): OpSpec[] =>
  [{ type: 'constraint_add', kind, refs, ...(expression === undefined ? {} : { expression }) }];

const wholeEntity = (picked: Picked): ConstraintRef => ({ handle: picked.entity.id, point: null });

/** `fixed` holds a whole line, or the one end a click landed on. */
function fixedRef(picked: Picked, env: CommandEnv): ConstraintRef {
  const line = picked.entity.entity;
  if (line.type !== 'line' || picked.entered === null) return wholeEntity(picked);
  const aperture = SNAP_APERTURE_PX / env.view.zoom;
  const start = measureDistance([line.x1, line.y1], picked.at).distance;
  const end = measureDistance([line.x2, line.y2], picked.at).distance;
  if (Math.min(start, end) > aperture) return wholeEntity(picked);
  return { handle: picked.entity.id, point: start <= end ? 'start' : 'end' };
}

/** The line end nearest `point` within the aperture; the lower handle number wins a tie because entities come in handle order. */
function lineEndAt(env: CommandEnv, point: Point): ConstraintRef | null {
  const aperture = SNAP_APERTURE_PX / env.view.zoom;
  let best: { ref: ConstraintRef; distance: number } | null = null;
  for (const scened of env.scene.entities) {
    const line = scened.entity;
    if (!scened.selectable || line.type !== 'line') continue;
    const ends: [ConstraintRef['point'], Point][] = [['start', [line.x1, line.y1]], ['end', [line.x2, line.y2]]];
    for (const [which, end] of ends) {
      const { distance } = measureDistance(end, point);
      if (distance <= aperture && (best === null || distance < best.distance)) best = { ref: { handle: scened.id, point: which }, distance };
    }
  }
  return best?.ref ?? null;
}

function endPoint(prompt: string, then: (ref: ConstraintRef) => Step): Stage {
  return pointStage(prompt, (point, env) => {
    const ref = lineEndAt(env, point);
    return ref ? then(ref) : stay(copy.NOTHING_TO_PICK);
  });
}

const expressionStage = (kind: ConstraintKind, refs: ConstraintRef[]): Stage =>
  textStage(PROMPTS.CONSTRAIN.expression, (text) => (text === '' ? stay() : finish(constraint(kind, refs, text))));

function oneEntity(kind: ConstraintKind, accepts: (entity: SceneEntity) => boolean): Stage {
  return pickOne(PROMPTS.CONSTRAIN.firstEntity, accepts, (picked, env) => {
    const refs = [kind === 'fixed' ? fixedRef(picked, env) : wholeEntity(picked)];
    return kind === 'length' || kind === 'radius' ? next(expressionStage(kind, refs)) : finish(constraint(kind, refs));
  });
}

const twoLines = (kind: ConstraintKind): Stage =>
  pickOne(PROMPTS.CONSTRAIN.firstEntity, isType('line'), (first) =>
    next(pickOne(PROMPTS.CONSTRAIN.secondEntity, isType('line'), (second) => finish(constraint(kind, [wholeEntity(first), wholeEntity(second)])))));

const coincident = (): Stage =>
  endPoint(PROMPTS.CONSTRAIN.firstPoint, (first) =>
    next(endPoint(PROMPTS.CONSTRAIN.secondPoint, (second) => finish(constraint('coincident', [first, second])))));

function stagesOf(kind: ConstraintKind): Stage {
  switch (kind) {
    case 'coincident': return coincident();
    case 'parallel': case 'perpendicular': case 'equal': return twoLines(kind);
    case 'radius': return oneEntity(kind, isType('circle'));
    case 'horizontal': case 'vertical': case 'fixed': case 'length': return oneEntity(kind, isType('line'));
  }
}

export const CONSTRAIN: Definition = {
  name: 'CONSTRAIN',
  alias: 'CN',
  edits: true,
  begin: () => next(wordStage(
    PROMPTS.CONSTRAIN.kind,
    Object.fromEntries(CONSTRAINT_KINDS.map((kind) => [kind.toUpperCase(), () => next(stagesOf(kind))])),
  )),
};

/** `d1 = 2 * (3 + 1)`: sets or creates a parameter. An empty Enter moves focus to the parameter list instead. */
export const PARAM: Definition = {
  name: 'PARAM',
  alias: 'PM',
  edits: true,
  begin: () => next(textStage(PROMPTS.PARAM.assignment, (text) => {
    if (text === '') return finish([], { focus: 'parameter-list' });
    const equals = text.indexOf('=');
    if (equals < 0) return stay();
    const name = text.slice(0, equals).trim();
    const expression = text.slice(equals + 1).trim();
    return name === '' || expression === '' ? stay() : finish([{ type: 'parameter_set', name, expression }]);
  })),
};
