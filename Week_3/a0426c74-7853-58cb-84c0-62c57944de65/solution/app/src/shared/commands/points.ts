// The typed forms of a number and of a point (Business rules: Point input forms).
import * as copy from '../copy.ts';
import { pointAtAngle, round6, roundPoint } from '../geometry/index.ts';
import type { Point } from '../types.ts';
import type { Entry } from './stages.ts';

const NUMBER = '[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)';
const ABSOLUTE = new RegExp(`^(${NUMBER})\\s*,\\s*(${NUMBER})$`);
const RELATIVE = new RegExp(`^@(${NUMBER})\\s*,\\s*(${NUMBER})$`);
const POLAR = new RegExp(`^@(${NUMBER})<(${NUMBER})$`);
const PLAIN_NUMBER = new RegExp(`^${NUMBER}$`);

export function parseNumber(text: string): number | null {
  return PLAIN_NUMBER.test(text) ? Number(text) : null;
}

/** `10,20`, `@5,0` (from the last point) or `@10<45` (distance and degrees counter-clockwise from +X). Null when `text` is none of them. */
export function parsePoint(text: string, last: Point): Point | null {
  const absolute = ABSOLUTE.exec(text);
  if (absolute) return [round6(Number(absolute[1])), round6(Number(absolute[2]))];
  const relative = RELATIVE.exec(text);
  if (relative) return [round6(last[0] + Number(relative[1])), round6(last[1] + Number(relative[2]))];
  const polar = POLAR.exec(text);
  if (polar) {
    return roundPoint(pointAtAngle(last, Number(polar[1]), Number(polar[2])));
  }
  return null;
}

/** True when the text was meant as a point (it has a comma or starts with `@`), so a failed read is a point refusal, not a number one. */
export function looksLikePoint(text: string): boolean {
  return text.includes(',') || text.startsWith('@');
}

export type Reading<T> = { ok: true; value: T } | { ok: false; message: string };
const ok = <T>(value: T): Reading<T> => ({ ok: true, value });
const refused = (message: string): Reading<never> => ({ ok: false, message });

/** A point stage: a click gives its point as is, typed text must be one of the three forms. */
export function readPoint(entry: Entry, last: Point): Reading<Point> {
  if (entry.kind === 'point') return ok(entry.point);
  const point = parsePoint(entry.text, last);
  return point ? ok(point) : refused(copy.NOT_A_POINT);
}

/** A number stage. A click is not a number. */
export function readNumber(entry: Entry): Reading<number> {
  const value = entry.kind === 'text' ? parseNumber(entry.text) : null;
  return value === null ? refused(copy.NOT_A_NUMBER) : ok(round6(value));
}

/** A radius, scale factor, count or row or column count: a number above zero. */
export function readPositive(entry: Entry): Reading<number> {
  const number = readNumber(entry);
  if (!number.ok) return number;
  return number.value > 0 ? number : refused(copy.NUMBER_ABOVE_ZERO);
}

/** A fillet radius or chamfer distance: zero is allowed (it acts as a corner). */
export function readNotNegative(entry: Entry): Reading<number> {
  const number = readNumber(entry);
  if (!number.ok) return number;
  return number.value >= 0 ? number : refused(copy.NUMBER_ABOVE_ZERO);
}

/** A count: a whole number above zero. */
export function readCount(entry: Entry): Reading<number> {
  const number = readNumber(entry);
  if (!number.ok) return number;
  const whole = Math.trunc(number.value);
  return whole > 0 ? ok(whole) : refused(copy.NUMBER_ABOVE_ZERO);
}

/** A stage with a default: an empty Enter gives `fallback`, otherwise `read` decides. */
export function readOrDefault(entry: Entry, fallback: number, read: (entry: Entry) => Reading<number>): Reading<number> {
  return entry.kind === 'text' && entry.text === '' ? ok(fallback) : read(entry);
}
