// Pick stages (Business rules: Picking): a typed handle, or a typed or clicked point that picks the nearest entity within the aperture.
import * as copy from '../copy.ts';
import { arcSweep, distance, midpoint, pickEntity, pointAtAngle, round6, type SceneEntity } from '../geometry/index.ts';
import type { Point } from '../types.ts';
import type { CommandEnv } from './env.ts';
import { parsePoint, type Reading } from './points.ts';
import { isEnter, next, stay, type Entry, type Stage, type Step } from './stages.ts';

const HANDLE = /^[A-Za-z]+\d+$/;

export interface Picked {
  entity: SceneEntity;
  /** where on the entity the pick happened: the typed or clicked point, or for a typed handle the entity's midpoint (circles: centre) */
  at: Point;
  /** the point the input entered, which becomes the last point; null for a typed handle */
  entered: Point | null;
}

/** The point halfway along a polyline's length. */
function halfwayAlong(points: readonly Point[], closed: boolean): Point {
  const corners = closed ? [...points, points[0]] : points;
  const lengths = corners.slice(1).map((end, i) => distance(end, corners[i]));
  let remaining = lengths.reduce((sum, length) => sum + length, 0) / 2;
  for (const [i, length] of lengths.entries()) {
    if (remaining <= length || i === lengths.length - 1) {
      const t = length === 0 ? 0 : remaining / length;
      return [corners[i][0] + (corners[i + 1][0] - corners[i][0]) * t, corners[i][1] + (corners[i + 1][1] - corners[i][1]) * t];
    }
    remaining -= length;
  }
  return corners[0];
}

/** A typed handle's pick point: the entity's midpoint, its centre for circles. */
function pickPointOf(entity: SceneEntity['entity']): Point {
  switch (entity.type) {
    case 'line': return midpoint([entity.x1, entity.y1], [entity.x2, entity.y2]);
    case 'circle': return [entity.cx, entity.cy];
    case 'arc': {
      return pointAtAngle([entity.cx, entity.cy], entity.r, entity.start + arcSweep(entity.start, entity.end) / 2);
    }
    case 'pline': return halfwayAlong(entity.points, entity.closed);
    case 'insert': return [entity.x, entity.y];
    case 'hatch': return [entity.seed_x, entity.seed_y];
    case 'dimension': return [entity.text_x, entity.text_y];
  }
}

/** Reads a pick-stage input that is not an empty Enter. `accepts` narrows what the stage can use; anything else is "nothing there". */
export function readPick(entry: Entry, env: CommandEnv, last: Point, accepts: (entity: SceneEntity) => boolean = () => true): Reading<Picked> {
  const nothing = { ok: false, message: copy.NOTHING_TO_PICK } as const;
  const usable = (hit: SceneEntity | null | undefined): hit is SceneEntity => !!hit && hit.selectable && accepts(hit);
  if (entry.kind === 'text' && HANDLE.test(entry.text)) {
    const hit = env.scene.byId.get(entry.text.toUpperCase());
    if (!usable(hit)) return nothing;
    const [x, y] = pickPointOf(hit.entity);
    return { ok: true, value: { entity: hit, at: [round6(x), round6(y)], entered: null } };
  }
  const point = entry.kind === 'point' ? entry.point : parsePoint(entry.text, last);
  if (point === null) return { ok: false, message: copy.NOT_A_POINT };
  const hit = pickEntity(env.scene, point, env.view);
  return usable(hit) ? { ok: true, value: { entity: hit, at: point, entered: point } } : nothing;
}

/** `Enter ends picking`: collects handles one pick at a time, then hands the list (possibly empty) to `done`. */
export function pickMany(
  prompt: string, accepts: (entity: SceneEntity) => boolean, done: (handles: readonly string[]) => Step, picked: readonly string[] = [],
): Stage {
  return {
    prompt,
    expects: 'pick',
    accept(entry, env, last) {
      if (isEnter(entry)) return done(picked);
      const hit = readPick(entry, env, last, accepts);
      if (!hit.ok) return stay(hit.message);
      const { entity, entered } = hit.value;
      const handles = picked.includes(entity.id) ? picked : [...picked, entity.id];
      return next(pickMany(prompt, accepts, done, handles), entered ?? undefined);
    },
  };
}

/** A picking stage that needs at least one entity before Enter can end it. */
export const needsSome = (done: (handles: readonly string[]) => Step) => (handles: readonly string[]): Step =>
  handles.length > 0 ? done(handles) : stay(copy.NOTHING_TO_PICK);

/** Picks at least one entity, then goes on to the stage that `then` builds from the picked handles. */
export const pickEntities = (prompt: string, then: (handles: readonly string[]) => Stage): Stage =>
  pickMany(prompt, () => true, needsSome((handles) => next(then(handles))));

export const isType = (...types: SceneEntity['entity']['type'][]) => (entity: SceneEntity): boolean => types.includes(entity.entity.type);

/** A stage that takes exactly one pick. */
export function pickOne(prompt: string, accepts: (entity: SceneEntity) => boolean, then: (picked: Picked, env: CommandEnv) => Step): Stage {
  return {
    prompt,
    expects: 'pick',
    accept(entry, env, last) {
      const hit = readPick(entry, env, last, accepts);
      return hit.ok ? { ...then(hit.value, env), point: hit.value.entered ?? undefined } : stay(hit.message);
    },
  };
}
