// DIMLINEAR, DIMALIGNED, DIMANGLE, DIMRADIUS: dimensions in the Standard style linked to the geometry they measure.
import * as copy from '../../copy.ts';
import { linkDimensionPoint } from '../../geometry/index.ts';
import type { DimensionKind, DimRef, Point } from '../../types.ts';
import { pointStage } from '../builders.ts';
import type { CommandEnv } from '../env.ts';
import { addOps } from '../ops.ts';
import { isType, pickOne } from '../picking.ts';
import { finish, next, PROMPTS, stay, type Definition, type Step } from '../stages.ts';

const STYLE = 'Standard';

function dimensionAt(kind: DimensionKind, refs: DimRef[], text: Point, env: CommandEnv): Step {
  return finish(addOps([{ type: 'dimension', layer: env.layer, kind, style: STYLE, refs, override: null, text_x: text[0], text_y: text[1] }]));
}

/** Two points, each of which must lie on an entity's start, end or centre to link to it. */
function twoPoints(name: string, alias: string, kind: 'linear' | 'aligned', prompts: { first: string; second: string; position: string }): Definition {
  return {
    name,
    alias,
    edits: true,
    begin: () => next(pointStage(prompts.first, (first) => next(pointStage(prompts.second, (second) => next(pointStage(prompts.position, (position, env) => {
      const start = linkDimensionPoint(env.state.entities, first);
      const end = linkDimensionPoint(env.state.entities, second);
      return start && end ? dimensionAt(kind, [start, end], position, env) : stay(copy.NOTHING_TO_PICK);
    })))))),
  };
}

export const DIMLINEAR = twoPoints('DIMLINEAR', 'DL', 'linear', PROMPTS.DIMLINEAR);
export const DIMALIGNED = twoPoints('DIMALIGNED', 'DA', 'aligned', PROMPTS.DIMALIGNED);

export const DIMANGLE: Definition = {
  name: 'DIMANGLE',
  alias: 'DG',
  edits: true,
  begin: () => next(pickOne(PROMPTS.DIMANGLE.first, isType('line'), (first) =>
    next(pickOne(PROMPTS.DIMANGLE.second, isType('line'), (second) =>
      next(pointStage(PROMPTS.DIMANGLE.position, (position, env) =>
        dimensionAt('angular', [{ handle: first.entity.id }, { handle: second.entity.id }], position, env)))))))
};

export const DIMRADIUS: Definition = {
  name: 'DIMRADIUS',
  alias: 'DR',
  edits: true,
  begin: () => next(pickOne(PROMPTS.DIMRADIUS.pick, isType('circle', 'arc'), (picked) =>
    next(pointStage(PROMPTS.DIMRADIUS.position, (position, env) =>
      dimensionAt('radial', [{ handle: picked.entity.id, point: 'centre' }], position, env))))),
};
