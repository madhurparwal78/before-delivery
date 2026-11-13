// HATCH, DIST, AREA: a point inside a boundary, and the two measuring commands.
import * as copy from '../../copy.ts';
import { areaOf, distReport, findHatch, fmt3 } from '../../geometry/index.ts';
import type { Point } from '../../types.ts';
import { pointStage } from '../builders.ts';
import type { CommandEnv } from '../env.ts';
import { addOps } from '../ops.ts';
import { readPick } from '../picking.ts';
import { parsePoint } from '../points.ts';
import { finish, next, PROMPTS, stay, type Definition, type Step } from '../stages.ts';

export const HATCH: Definition = {
  name: 'HATCH',
  alias: 'H',
  edits: true,
  begin: () => next(pointStage(PROMPTS.HATCH.seed, ([seedX, seedY], env) =>
    finish(addOps([{ type: 'hatch', layer: env.layer, seed_x: seedX, seed_y: seedY }])))),
};

/** The result replaces the prompt text and the command stays at its stage, so a second point measures again. */
export const DIST: Definition = {
  name: 'DIST',
  alias: 'DI',
  edits: false,
  begin: () => next(pointStage(PROMPTS.DIST.first, (first) => next(pointStage(PROMPTS.DIST.second, (second) => {
    return stay(distReport(first, second));
  })))),
};

/** The area of a point inside a boundary, by the hatch rule. */
const hatchArea = (point: Point, env: CommandEnv): number | undefined => findHatch(point, env.state.entities, env.state.layers)?.area;

const reportArea = (area: number | undefined, entered: Point | undefined): Step =>
  stay(area === undefined ? copy.NO_BOUNDARY : copy.areaResult(fmt3(area)), entered);

export const AREA: Definition = {
  name: 'AREA',
  alias: 'AA',
  edits: false,
  begin: () => next({
    prompt: PROMPTS.AREA.pick,
    expects: 'pick',
    accept(entry, env, last) {
      const hit = readPick(entry, env, last);
      if (hit.ok) return reportArea(areaOf(hit.value.entity.entity) ?? hatchArea(hit.value.at, env), hit.value.entered ?? undefined);
      const point = entry.kind === 'point' ? entry.point : parsePoint(entry.text, last);
      return point === null ? stay(hit.message) : reportArea(hatchArea(point, env), point);
    },
  }),
};
