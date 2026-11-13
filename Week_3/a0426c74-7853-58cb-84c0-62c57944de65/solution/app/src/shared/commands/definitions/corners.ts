// FILLET and CHAMFER: two lines and the radius or distances that round or cut their corner.
import * as copy from '../../copy.ts';
import { chamfer, fillet, isRefusal } from '../../geometry/index.ts';
import type { Entity, Point } from '../../types.ts';
import type { CommandEnv } from '../env.ts';
import { numberStage } from '../builders.ts';
import { opsOfResult } from '../ops.ts';
import { readPick } from '../picking.ts';
import { readNotNegative } from '../points.ts';
import { finish, next, PROMPTS, stay, type Definition, type Entry, type Stage, type Step } from '../stages.ts';

type Line = Extract<Entity, { type: 'line' }>;
interface PickedLine { line: Line; at: Point }

function linePick(prompt: string, then: (picked: PickedLine) => Step): Stage {
  return {
    prompt,
    expects: 'pick',
    accept(entry: Entry, env: CommandEnv, last: Point) {
      const hit = readPick(entry, env, last);
      if (!hit.ok) return stay(hit.message);
      const { entity, at, entered } = hit.value;
      if (entity.entity.type !== 'line') return stay(copy.NOTHING_TO_PICK);
      return { ...then({ line: entity.entity, at }), point: entered ?? undefined };
    },
  };
}

export const FILLET: Definition = {
  name: 'FILLET',
  alias: 'F',
  edits: true,
  begin: () => next(numberStage(PROMPTS.FILLET.radius, readNotNegative, (radius) =>
    next(linePick(PROMPTS.FILLET.first, (first) =>
      next(linePick(PROMPTS.FILLET.second, (second) => {
        const result = fillet(first.line, first.at, second.line, second.at, radius);
        return isRefusal(result) ? stay(result.refused) : finish(opsOfResult(result));
      })))))),
};

export const CHAMFER: Definition = {
  name: 'CHAMFER',
  alias: 'CHA',
  edits: true,
  begin: () => next(numberStage(PROMPTS.CHAMFER.first, readNotNegative, (distance1) =>
    next(numberStage(PROMPTS.CHAMFER.second, readNotNegative, (distance2) =>
      next(linePick(PROMPTS.CHAMFER.firstLine, (first) =>
        next(linePick(PROMPTS.CHAMFER.secondLine, (second) => {
          const result = chamfer(first.line, first.at, second.line, second.at, distance1, distance2);
          return isRefusal(result) ? stay(result.refused) : finish(opsOfResult(result));
        })))))))),
};
