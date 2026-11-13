// LINE, PLINE, RECT, CIRCLE, ARC: new geometry on the current layer.
import * as copy from '../../copy.ts';
import { measureDistance } from '../../geometry/index.ts';
import type { EntityDraft, Point } from '../../types.ts';
import { pointStage } from '../builders.ts';
import type { CommandEnv } from '../env.ts';
import { addOps } from '../ops.ts';
import { looksLikePoint, parsePoint, readNumber, readPoint, type Reading } from '../points.ts';
import { finish, isEnter, next, PROMPTS, stay, wordOf, type Definition, type Entry, type OpSpec, type Stage } from '../stages.ts';

const lineDraft = (a: Point, b: Point, env: CommandEnv): EntityDraft => ({ type: 'line', layer: env.layer, x1: a[0], y1: a[1], x2: b[0], y2: b[1] });

/** Each segment is its own line; a closed run adds the segment back to the first point. */
function segments(points: readonly Point[], closed: boolean, env: CommandEnv): OpSpec[] {
  const corners = closed ? [...points, points[0]] : points;
  return addOps(corners.slice(1).map((end, i) => lineDraft(corners[i], end, env)));
}

function lineTo(points: readonly Point[]): Stage {
  return {
    prompt: PROMPTS.LINE.to,
    expects: 'point',
    accept(entry, env, last) {
      if (isEnter(entry)) return finish(segments(points, false, env));
      if (wordOf(entry) === 'CL') return points.length >= 3 ? finish(segments(points, true, env)) : stay(copy.NOT_A_POINT);
      const point = readPoint(entry, last);
      if (!point.ok) return stay(point.message);
      return next(lineTo([...points, point.value]), point.value);
    },
    preview: (cursor, env) => [lineDraft(points[points.length - 1], cursor, env)],
  };
}

export const LINE: Definition = {
  name: 'LINE',
  alias: 'L',
  edits: true,
  begin: () => next(pointStage(PROMPTS.LINE.from, (from) => next(lineTo([from])))),
};

function plineTo(points: readonly Point[]): Stage {
  const pline = (closed: boolean, env: CommandEnv): OpSpec[] =>
    points.length >= 2 ? addOps([{ type: 'pline', layer: env.layer, points: [...points], closed }]) : [];
  return {
    prompt: PROMPTS.PLINE.to,
    expects: 'point',
    accept(entry, env, last) {
      if (isEnter(entry)) return finish(pline(false, env));
      if (wordOf(entry) === 'CL') return points.length >= 3 ? finish(pline(true, env)) : stay(copy.NOT_A_POINT);
      const point = readPoint(entry, last);
      if (!point.ok) return stay(point.message);
      return next(plineTo([...points, point.value]), point.value);
    },
    preview: (cursor, env) => [{ type: 'pline', layer: env.layer, points: [...points, cursor], closed: false }],
  };
}

export const PLINE: Definition = {
  name: 'PLINE',
  alias: 'PL',
  edits: true,
  begin: () => next(pointStage(PROMPTS.PLINE.from, (from) => next(plineTo([from])))),
};

/** The four corners starting at `first` and going counter-clockwise. */
function rectangle(first: Point, opposite: Point): Point[] {
  const [x1, y1] = first;
  const [x2, y2] = opposite;
  const counterClockwise = (x2 - x1) * (y2 - y1) >= 0;
  return counterClockwise ? [[x1, y1], [x2, y1], [x2, y2], [x1, y2]] : [[x1, y1], [x1, y2], [x2, y2], [x2, y1]];
}

export const RECT: Definition = {
  name: 'RECT',
  alias: 'REC',
  edits: true,
  begin: () => next(pointStage(PROMPTS.RECT.first, (first) => next(pointStage(
    PROMPTS.RECT.opposite,
    (opposite, env) => finish(addOps([{ type: 'pline', layer: env.layer, points: rectangle(first, opposite), closed: true }])),
    (cursor, env) => [{ type: 'pline', layer: env.layer, points: rectangle(first, cursor), closed: true }],
  )))),
};

/** A radius is a number, or a point whose distance from the centre is the radius. */
function readRadius(entry: Entry, centre: Point, last: Point): Reading<{ radius: number; entered: Point | null }> {
  let entered: Point | null = null;
  if (entry.kind === 'point') entered = entry.point;
  else if (looksLikePoint(entry.text)) {
    entered = parsePoint(entry.text, last);
    if (entered === null) return { ok: false, message: copy.NOT_A_POINT };
  }
  if (entered !== null) {
    const { distance } = measureDistance(centre, entered);
    return distance > 0 ? { ok: true, value: { radius: distance, entered } } : { ok: false, message: copy.NUMBER_ABOVE_ZERO };
  }
  const number = readNumber(entry);
  if (!number.ok) return number;
  return number.value > 0 ? { ok: true, value: { radius: number.value, entered: null } } : { ok: false, message: copy.NUMBER_ABOVE_ZERO };
}

const circleDraft = (centre: Point, radius: number, env: CommandEnv): EntityDraft => ({ type: 'circle', layer: env.layer, cx: centre[0], cy: centre[1], r: radius });

export const CIRCLE: Definition = {
  name: 'CIRCLE',
  alias: 'C',
  edits: true,
  begin: () => next(pointStage(PROMPTS.CIRCLE.centre, (centre) => next({
    prompt: PROMPTS.CIRCLE.radius,
    expects: 'point',
    accept(entry, env, last) {
      const radius = readRadius(entry, centre, last);
      if (!radius.ok) return stay(radius.message);
      return finish(addOps([circleDraft(centre, radius.value.radius, env)]), {}, radius.value.entered ?? undefined);
    },
    preview(cursor, env) {
      const { distance } = measureDistance(centre, cursor);
      return distance > 0 ? [circleDraft(centre, distance, env)] : [];
    },
  }))),
};

export const ARC: Definition = {
  name: 'ARC',
  alias: 'A',
  edits: true,
  begin: () => next(pointStage(PROMPTS.ARC.centre, (centre) => next(pointStage(PROMPTS.ARC.start, (start) => {
    const { distance: radius, angle: startAngle } = measureDistance(centre, start);
    if (radius === 0) return stay(copy.NUMBER_ABOVE_ZERO);
    return next(pointStage(PROMPTS.ARC.end, (end, env) => {
      const { distance, angle: endAngle } = measureDistance(centre, end);
      if (distance === 0) return stay(copy.NOT_A_POINT);
      return finish(addOps([{ type: 'arc', layer: env.layer, cx: centre[0], cy: centre[1], r: radius, start: startAngle, end: endAngle }]));
    }));
  })))),
};
