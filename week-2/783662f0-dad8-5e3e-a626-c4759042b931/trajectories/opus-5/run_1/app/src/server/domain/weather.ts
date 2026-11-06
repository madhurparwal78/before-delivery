import { config } from '../config.js';
import type { WeatherObject } from '../../shared/types.js';
import { instant } from '../util.js';

/** The weather and day cycle are decided from the published schedule. */

const CYCLE: readonly WeatherObject['weather'][] = ['clear', 'rain', 'clear', 'storm'];

export function weatherOf(seed: number, at: Date = new Date()): WeatherObject {
  const { weatherPeriodSeconds, dayCycleSeconds } = config();
  const epochSeconds = Math.floor(at.getTime() / 1000);
  const period = Math.floor(epochSeconds / weatherPeriodSeconds);
  const weather = CYCLE[((period + seed) % 4 + 4) % 4];
  const since = new Date(period * weatherPeriodSeconds * 1000);
  const changesAt = new Date((period + 1) * weatherPeriodSeconds * 1000);
  const phase = (epochSeconds % dayCycleSeconds) / dayCycleSeconds;
  return {
    weather,
    since: instant(since),
    changes_at: instant(changesAt),
    night_level: nightLevel(phase),
  };
}

const POINTS: readonly { phase: number; level: number }[] = [
  { phase: 0, level: 0.45 },
  { phase: 0.25, level: 0.15 },
  { phase: 0.5, level: 0 },
  { phase: 0.75, level: 0.15 },
  { phase: 1, level: 0.45 },
];

/** Linear between the published points, rounded to three decimals. */
export function nightLevel(phase: number): number {
  const clamped = Math.min(Math.max(phase, 0), 1);
  for (let i = 1; i < POINTS.length; i += 1) {
    const previous = POINTS[i - 1];
    const next = POINTS[i];
    if (clamped <= next.phase) {
      const span = next.phase - previous.phase;
      const ratio = span === 0 ? 0 : (clamped - previous.phase) / span;
      const level = previous.level + (next.level - previous.level) * ratio;
      return Math.round(level * 1000) / 1000;
    }
  }
  return 0.45;
}

