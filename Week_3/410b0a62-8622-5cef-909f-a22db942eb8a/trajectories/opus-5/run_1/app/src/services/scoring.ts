import type { Queryable } from '../db/pool.js';
import {
  completedOfSportInSpan,
  completedTssByDate,
  updateScores,
} from '../db/workouts.js';
import { replaceSeriesFrom, seriesDay } from '../db/records.js';
import type { UserRow } from '../db/users.js';
import { computeSeries } from '../domain/series.js';
import { scoreBike, scoreRun } from '../domain/stress.js';
import { addDays, maxDate } from '../domain/time.js';
import type { Sport, ThresholdKind } from '../domain/types.js';

export function sportOfThreshold(kind: ThresholdKind): Sport {
  return kind === 'ftp' ? 'bike' : 'run';
}

export function thresholdOfSport(sport: Sport): ThresholdKind {
  return sport === 'bike' ? 'ftp' : 'pace';
}

export interface CompletedScores {
  tss: number;
  intensityFactor: number;
  npW: number | null;
  nsMps: number | null;
}

/** The one place a completed session's stress is decided from its normalised value. */
export function scoreWithThreshold(
  sport: Sport,
  durationS: number,
  normalised: number,
  threshold: number,
): CompletedScores {
  if (sport === 'bike') {
    const score = scoreBike(durationS, normalised, threshold);
    return { tss: score.tss, intensityFactor: score.if, npW: normalised, nsMps: null };
  }
  const score = scoreRun(durationS, normalised, threshold);
  return { tss: score.tss, intensityFactor: score.if, npW: null, nsMps: normalised };
}

export function seriesStartOf(athlete: UserRow, today: string): string {
  return athlete.series_start ?? today;
}

/** Recomputes and stores the daily series from the first affected day. */
export async function recomputeSeriesFrom(
  client: Queryable,
  athlete: UserRow,
  affectedFrom: string,
  today: string,
): Promise<string> {
  const seriesStart = seriesStartOf(athlete, today);
  let from = maxDate(affectedFrom, seriesStart);
  let previous = { ctl: athlete.start_ctl, atl: athlete.start_atl };
  if (from > seriesStart) {
    const dayBefore = await seriesDay(client, athlete.id, addDays(from, -1));
    if (dayBefore) {
      previous = { ctl: dayBefore.ctl, atl: dayBefore.atl };
    } else {
      from = seriesStart;
    }
  }
  if (from > today) {
    await replaceSeriesFrom(client, athlete.id, from, []);
    return from;
  }
  const tssByDate = await completedTssByDate(client, athlete.id, from, today);
  const days = computeSeries(from, today, tssByDate, previous);
  await replaceSeriesFrom(client, athlete.id, from, days);
  return from;
}

/**
 * Re-scores exactly the completed workouts of a threshold's sport inside its
 * span, from its effective date to the day before the next later entry.
 */
export async function rescoreThresholdSpan(
  client: Queryable,
  athleteId: string,
  kind: ThresholdKind,
  value: number,
  from: string,
  to: string | null,
): Promise<number> {
  const sport = sportOfThreshold(kind);
  const workouts = await completedOfSportInSpan(client, athleteId, sport, from, to);
  for (const workout of workouts) {
    const normalised = (sport === 'bike' ? workout.np_w : workout.ns_mps) as number;
    const scores = scoreWithThreshold(sport, workout.duration_s, normalised, value);
    await updateScores(client, workout.id, {
      tss: scores.tss,
      intensityFactor: scores.intensityFactor,
      npW: scores.npW,
      nsMps: scores.nsMps,
    });
  }
  return workouts.length;
}
