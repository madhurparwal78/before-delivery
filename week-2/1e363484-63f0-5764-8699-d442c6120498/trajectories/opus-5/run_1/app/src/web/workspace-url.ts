import type { ProjectDetail } from './api';
import {
  compactStamp,
  DAY_MS,
  dateOnly,
  HALF_HOUR_MS,
  parseCompactStamp,
  parseDateOnly,
} from './format';

export interface WorkspaceState {
  readonly windowStartMs: number;
  readonly windowEndMs: number;
  readonly fromDayMs: number;
  readonly toDayMs: number;
  readonly brushStartMs: number;
  readonly brushEndMs: number;
  readonly sensors: readonly string[];
}

function byteOrder(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function dayOf(ms: number): number {
  return Math.floor(ms / DAY_MS) * DAY_MS;
}

/**
 * Reads the window, brush and sensors from an address, checking them in the three steps
 * the Interactions section states and falling back to the defaults.
 */
export function parseWorkspaceUrl(
  project: ProjectDetail,
  search: string,
): WorkspaceState | null {
  if (project.record_start === null || project.record_end === null) return null;
  const recordStartMs = Date.parse(project.record_start);
  const recordEndMs = Date.parse(project.record_end);
  const firstDayMs = dayOf(recordStartMs);
  const lastDayMs = dayOf(recordEndMs - 1);
  const params = new URLSearchParams(search);

  const fromRaw = params.get('from');
  const toRaw = params.get('to');
  const fromParsed = fromRaw === null ? null : parseDateOnly(fromRaw);
  const toParsed = toRaw === null ? null : parseDateOnly(toRaw);
  let fromDayMs = firstDayMs;
  let toDayMs = lastDayMs;
  if (
    fromParsed !== null &&
    toParsed !== null &&
    fromParsed >= firstDayMs &&
    fromParsed <= lastDayMs &&
    toParsed >= firstDayMs &&
    toParsed <= lastDayMs &&
    fromParsed <= toParsed
  ) {
    fromDayMs = fromParsed;
    toDayMs = toParsed;
  }
  const windowStartMs = Math.max(recordStartMs, fromDayMs);
  const windowEndMs = Math.min(recordEndMs, toDayMs + DAY_MS);

  const startRaw = params.get('start');
  const endRaw = params.get('end');
  const startParsed = startRaw === null ? null : parseCompactStamp(startRaw);
  const endParsed = endRaw === null ? null : parseCompactStamp(endRaw);
  let brushStartMs = windowStartMs;
  let brushEndMs = windowEndMs;
  if (
    startParsed !== null &&
    endParsed !== null &&
    startParsed % HALF_HOUR_MS === 0 &&
    endParsed % HALF_HOUR_MS === 0 &&
    startParsed >= windowStartMs &&
    endParsed <= windowEndMs &&
    startParsed < endParsed
  ) {
    brushStartMs = startParsed;
    brushEndMs = endParsed;
  }

  const known = project.sensors.map((sensor) => sensor.id);
  const sensorsRaw = params.get('sensors');
  let sensors = [...known].sort(byteOrder);
  if (sensorsRaw !== null && sensorsRaw !== '') {
    const given = sensorsRaw.split(',');
    const unique = new Set(given);
    if (
      given.length === unique.size &&
      given.every((id) => known.includes(id)) &&
      given.length > 0
    ) {
      sensors = [...unique].sort(byteOrder);
    }
  }

  return {
    windowStartMs,
    windowEndMs,
    fromDayMs,
    toDayMs,
    brushStartMs,
    brushEndMs,
    sensors,
  };
}

/** The canonical workspace address, with its parameters in exactly the published order. */
export function workspaceUrl(slug: string, state: WorkspaceState | null): string {
  if (state === null) return `/projects/${slug}`;
  const params = [
    `from=${dateOnly(state.fromDayMs)}`,
    `to=${dateOnly(state.toDayMs)}`,
    `start=${compactStamp(state.brushStartMs)}`,
    `end=${compactStamp(state.brushEndMs)}`,
    `sensors=${[...state.sensors].sort(byteOrder).join(',')}`,
  ];
  return `/projects/${slug}?${params.join('&')}`;
}

export function sortSensors(sensors: readonly string[]): string[] {
  return [...sensors].sort(byteOrder);
}
