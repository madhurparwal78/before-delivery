// MOVE, COPY, ROTATE, SCALE, MIRROR, ERASE, ARRAY, OFFSET: commands that work on picked entities.
import * as copy from '../../copy.ts';
import {
  changedFields, measureDistance, offsetEntity, polarArray, rectangularArray, round6, transformEntity, type Transform,
} from '../../geometry/index.ts';
import type { EntityDraft, OperationGroup, Point } from '../../types.ts';
import { numberStage, pointStage, wordStage } from '../builders.ts';
import type { CommandEnv } from '../env.ts';
import { addOps, draftOf, groupOf, modelEntity } from '../ops.ts';
import { isType, pickEntities, pickMany, readPick } from '../picking.ts';
import { readCount, readNumber, readPoint, readPositive } from '../points.ts';
import { finish, isEnter, next, PROMPTS, stay, type Definition, type OpSpec, type Stage } from '../stages.ts';

const displacement = (from: Point, to: Point): { dx: number; dy: number } => ({ dx: round6(to[0] - from[0]), dy: round6(to[1] - from[1]) });

/** `modify` ops for the picked entities that `transform` changes. */
function transformOps(handles: readonly string[], transform: Transform, env: CommandEnv): OpSpec[] {
  return handles.flatMap((handle): OpSpec[] => {
    const before = modelEntity(env, handle);
    const set = changedFields(before, transformEntity(before, transform));
    return Object.keys(set).length > 0 ? [{ type: 'modify', handle, set }] : [];
  });
}

const transformed = (handles: readonly string[], transform: Transform, env: CommandEnv): EntityDraft[] =>
  handles.map((handle) => draftOf(transformEntity(modelEntity(env, handle), transform)));

const displaced = (handles: readonly string[], from: Point, to: Point, env: CommandEnv): EntityDraft[] =>
  transformed(handles, { kind: 'translate', ...displacement(from, to) }, env);

const moveTo = (handles: readonly string[], from: Point): Stage =>
  pointStage(
    PROMPTS.MOVE.to,
    (to) => finish([{ type: 'move', handles: [...handles], ...displacement(from, to) }]),
    (cursor, env) => displaced(handles, from, cursor, env),
  );

export const MOVE: Definition = {
  name: 'MOVE',
  alias: 'M',
  edits: true,
  begin: () => next(pickEntities(PROMPTS.MOVE.pick, (handles) =>
    pointStage(PROMPTS.MOVE.from, (from) => next(moveTo(handles, from))))),
};

/** Every target point adds copies of the picked entities, displaced by the target minus the from point; Enter ends the run. */
function copyTo(handles: readonly string[], from: Point, targets: readonly Point[]): Stage {
  return {
    prompt: PROMPTS.COPY.to,
    expects: 'point',
    accept(entry, env, last) {
      if (isEnter(entry)) {
        return finish(addOps(targets.flatMap((to) => displaced(handles, from, to, env))));
      }
      const to = readPoint(entry, last);
      return to.ok ? next(copyTo(handles, from, [...targets, to.value]), to.value) : stay(to.message);
    },
    preview: (cursor, env) => displaced(handles, from, cursor, env),
  };
}

export const COPY: Definition = {
  name: 'COPY',
  alias: 'CO',
  edits: true,
  begin: () => next(pickEntities(PROMPTS.COPY.pick, (handles) =>
    pointStage(PROMPTS.COPY.from, (from) => next(copyTo(handles, from, []))))),
};

export const ROTATE: Definition = {
  name: 'ROTATE',
  alias: 'RO',
  edits: true,
  begin: () => next(pickEntities(PROMPTS.ROTATE.pick, (handles) =>
    pointStage(PROMPTS.ROTATE.about, (about) => next(
      numberStage(PROMPTS.ROTATE.angle, readNumber, (degrees, env) => finish(transformOps(handles, { kind: 'rotate', about, degrees }, env))),
    )))),
};

export const SCALE: Definition = {
  name: 'SCALE',
  alias: 'SC',
  edits: true,
  begin: () => next(pickEntities(PROMPTS.SCALE.pick, (handles) =>
    pointStage(PROMPTS.SCALE.about, (about) => next(
      numberStage(PROMPTS.SCALE.factor, readPositive, (factor, env) => finish(transformOps(handles, { kind: 'scale', about, factor }, env))),
    )))),
};

/** Y or Enter keeps the originals, N erases them. */
function keepOriginals(handles: readonly string[], from: Point, to: Point): Stage {
  const mirror = (keep: boolean) => (env: CommandEnv) => {
    const made = addOps(transformed(handles, { kind: 'mirror', from, to }, env));
    return finish(keep ? made : [...made, { type: 'delete', handles: [...handles] }]);
  };
  return wordStage(PROMPTS.MIRROR.keep, { Y: mirror(true), N: mirror(false) }, 'Y');
}

const mirrorAxis = (handles: readonly string[], from: Point): Stage =>
  pointStage(PROMPTS.MIRROR.second, (to) =>
    measureDistance(from, to).distance === 0 ? stay(copy.NOT_A_POINT) : next(keepOriginals(handles, from, to)));

export const MIRROR: Definition = {
  name: 'MIRROR',
  alias: 'MI',
  edits: true,
  begin: () => next(pickEntities(PROMPTS.MIRROR.pick, (handles) =>
    pointStage(PROMPTS.MIRROR.first, (from) => next(mirrorAxis(handles, from))))),
};

const eraseOps = (handles: readonly string[]): OpSpec[] => (handles.length > 0 ? [{ type: 'delete', handles: [...handles] }] : []);

/** ERASE with a selection erases it at once; this is also what the Delete key submits. */
export const eraseGroup = (handles: readonly string[], env: CommandEnv): OperationGroup => groupOf('ERASE', eraseOps(handles), env);

export const ERASE: Definition = {
  name: 'ERASE',
  alias: 'E',
  edits: true,
  begin: (env) => env.selection.length > 0
    ? finish(eraseOps(env.selection))
    : next(pickMany(PROMPTS.ERASE.pick, () => true, (handles) => finish(eraseOps(handles)))),
};

/** Rows and columns: copies row by row, rows going up and columns going right. */
const arrayColumnGap = (handles: readonly string[], rows: number, columns: number, rowGap: number): Stage =>
  numberStage(PROMPTS.ARRAY.columnGap, readNumber, (columnGap, env) =>
    finish(addOps(handles.flatMap((handle) => rectangularArray(modelEntity(env, handle), rows, columns, rowGap, columnGap)))));

const arrayRowGap = (handles: readonly string[], rows: number, columns: number): Stage =>
  numberStage(PROMPTS.ARRAY.rowGap, readNumber, (rowGap) => next(arrayColumnGap(handles, rows, columns, rowGap)));

const arrayColumns = (handles: readonly string[], rows: number): Stage =>
  numberStage(PROMPTS.ARRAY.columns, readCount, (columns) => next(arrayRowGap(handles, rows, columns)));

const arrayRows = (handles: readonly string[]): Stage =>
  numberStage(PROMPTS.ARRAY.rows, readCount, (rows) => next(arrayColumns(handles, rows)));

/** Polar: copies about a centre, each rotated with its position. */
const arrayTotalAngle = (handles: readonly string[], centre: Point, count: number): Stage =>
  numberStage(PROMPTS.ARRAY.totalAngle, readNumber, (totalAngle, env) =>
    finish(addOps(handles.flatMap((handle) => polarArray(modelEntity(env, handle), centre, count, totalAngle)))));

const arrayCount = (handles: readonly string[], centre: Point): Stage =>
  numberStage(PROMPTS.ARRAY.count, readCount, (count) => next(arrayTotalAngle(handles, centre, count)));

const arrayCentre = (handles: readonly string[]): Stage =>
  pointStage(PROMPTS.ARRAY.centre, (centre) => next(arrayCount(handles, centre)));

export const ARRAY: Definition = {
  name: 'ARRAY',
  alias: 'AR',
  edits: true,
  begin: () => next(pickEntities(PROMPTS.ARRAY.pick, (handles) =>
    wordStage(PROMPTS.ARRAY.kind, { R: () => next(arrayRows(handles)), P: () => next(arrayCentre(handles)) }))),
};

/** Offsets keep returning to "pick entity" until Enter, which ends the run with all the new entities. */
function offsetPick(distance: number, made: readonly EntityDraft[]): Stage {
  return {
    prompt: PROMPTS.OFFSET.entity,
    expects: 'pick',
    accept(entry, env, last) {
      if (isEnter(entry)) return finish(addOps(made));
      const hit = readPick(entry, env, last, isType('line', 'circle', 'arc', 'pline'));
      if (!hit.ok) return stay(hit.message);
      const { entity, at, entered } = hit.value;
      return next(pointStage(PROMPTS.OFFSET.side, (side) => {
        const result = offsetEntity(entity.entity, distance, at, side);
        return 'refused' in result ? stay(result.refused) : next(offsetPick(distance, [...made, result]));
      }), entered ?? undefined);
    },
  };
}

export const OFFSET: Definition = {
  name: 'OFFSET',
  alias: 'O',
  edits: true,
  begin: () => next(numberStage(PROMPTS.OFFSET.distance, readPositive, (distance) => next(offsetPick(distance, [])))),
};
