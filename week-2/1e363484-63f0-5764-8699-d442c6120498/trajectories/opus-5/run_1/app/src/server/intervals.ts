import { compareSensorIds } from '../domain/derivation';
import { isHalfHour, parseTimestamp } from '../domain/time';
import { ValidationError } from './http/errors';
import type { Project, RecordBounds } from './projects';

export interface IntervalRequest {
  readonly startMs: number;
  readonly endMs: number;
  readonly sensorIds: readonly string[];
}

/** The shared validation for previews and seals, keyed exactly as the API section states. */
export function validateIntervalRequest(
  project: Project,
  bounds: RecordBounds,
  startRaw: unknown,
  endRaw: unknown,
  sensorsRaw: unknown,
): IntervalRequest {
  const errors: Record<string, string> = {};
  const startMs = parseTimestamp(startRaw);
  const endMs = parseTimestamp(endRaw);

  if (startMs === null) {
    errors.start = 'Give start as YYYY-MM-DDTHH:MM:SSZ.';
  } else if (!isHalfHour(startMs)) {
    errors.start = 'start must be on an exact half-hour.';
  } else if (bounds.startMs === null || startMs < bounds.startMs) {
    errors.start = 'start must be no earlier than the first reading.';
  }

  if (endMs === null) {
    errors.end = 'Give end as YYYY-MM-DDTHH:MM:SSZ.';
  } else if (!isHalfHour(endMs)) {
    errors.end = 'end must be on an exact half-hour.';
  } else if (bounds.endMs === null || endMs > bounds.endMs) {
    errors.end = 'end must be no later than the last reading.';
  }

  if (
    startMs !== null &&
    endMs !== null &&
    errors.start === undefined &&
    errors.end === undefined &&
    startMs >= endMs
  ) {
    errors.start = 'start must be earlier than end.';
  }

  let sensorIds: string[] = [];
  if (!Array.isArray(sensorsRaw) || sensorsRaw.length === 0) {
    errors.sensor_ids = 'Give at least one sensor id.';
  } else {
    const known = new Set(project.sensors.map((sensor) => sensor.id));
    const seen = new Set<string>();
    for (const value of sensorsRaw) {
      if (typeof value !== 'string' || !known.has(value) || seen.has(value)) {
        errors.sensor_ids = 'Give distinct sensor ids of this project.';
        break;
      }
      seen.add(value);
    }
    sensorIds = [...seen].sort(compareSensorIds);
  }

  if (Object.keys(errors).length > 0) throw new ValidationError(errors);
  return { startMs: startMs!, endMs: endMs!, sensorIds };
}
