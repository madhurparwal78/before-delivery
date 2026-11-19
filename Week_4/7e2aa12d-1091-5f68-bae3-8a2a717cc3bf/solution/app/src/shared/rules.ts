import {
  AREA_NAME_MESSAGE,
  BREAKPOINT_RANGE_MESSAGE,
  CSS_LONG_MESSAGE,
  GAP_MESSAGE,
  LAYOUT_NAME_MESSAGE,
  PASSWORD_MESSAGE,
  RESERVED_NAME_MESSAGE,
  USERNAME_MESSAGE,
  VERSION_NAME_MESSAGE,
  duplicateBreakpoint,
  needsTrack,
  tooManyBreakpoints,
  tooManyTracks,
} from './messages.js';
import type { Axis } from './types.js';

const GAP_MAX = 200;
const BREAKPOINT_MIN_WIDTH = 400;
const BREAKPOINT_MAX_WIDTH = 1440;
const CSS_LIMIT = 20_000;
const RESERVED_NAME = 'layout';

const USERNAME = /^[a-z][a-z0-9-]{2,23}$/;
const AREA_NAME = /^[a-z][a-z0-9-]{0,23}$/;

const length = (text: string): number => [...text].length;

export const checkUsername = (value: string): string | null => (USERNAME.test(value) ? null : USERNAME_MESSAGE);
export const checkPassword = (value: string): string | null => (length(value) >= 8 && length(value) <= 128 ? null : PASSWORD_MESSAGE);

/** The name rule first, then the reserved name. */
export function checkAreaName(value: string): string | null {
  if (!AREA_NAME.test(value)) return AREA_NAME_MESSAGE;
  return value === RESERVED_NAME ? RESERVED_NAME_MESSAGE : null;
}

export const checkGap = (value: number): string | null => (Number.isInteger(value) && value >= 0 && value <= GAP_MAX ? null : GAP_MESSAGE);

export const checkBreakpointWidth = (value: number): string | null =>
  Number.isInteger(value) && value >= BREAKPOINT_MIN_WIDTH && value <= BREAKPOINT_MAX_WIDTH ? null : BREAKPOINT_RANGE_MESSAGE;

export const checkCssLength = (css: string): string | null => (length(css) <= CSS_LIMIT ? null : CSS_LONG_MESSAGE);

/** A scope holds 1 to `max` tracks per axis: the message for a count outside that, else null. */
export function checkTrackCount(axis: Axis, count: number, max: number): string | null {
  if (count < 1) return needsTrack(axis);
  return count > max ? tooManyTracks(axis, max) : null;
}

/** A new breakpoint at `width` beside the existing ones: one per width, at most `max`. */
export function checkBreakpointAdd(existing: number[], width: number, max: number): string | null {
  if (existing.includes(width)) return duplicateBreakpoint(width);
  return existing.length >= max ? tooManyBreakpoints(max) : null;
}

/** A name of 1 to `max` characters after trimming; the trimmed name, or the message. */
function trimmedName(value: string, max: number, message: string): { name: string } | { message: string } {
  const name = value.trim();
  return length(name) >= 1 && length(name) <= max ? { name } : { message };
}

export const layoutName = (value: string) => trimmedName(value, 80, LAYOUT_NAME_MESSAGE);
export const versionName = (value: string) => trimmedName(value, 60, VERSION_NAME_MESSAGE);
