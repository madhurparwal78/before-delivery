import type { ComplianceState, Item, Sport, WeekTally, Workout } from './types.js';

/** The compliance ratio of a paired day: completed over planned, by TSS or duration. */
export function pairRatio(planned: Workout, completed: Workout): number {
  if (planned.planned_tss !== null && completed.tss !== null) {
    return completed.tss / planned.planned_tss;
  }
  return completed.duration_s / planned.duration_s;
}

export function ratioState(ratio: number): ComplianceState {
  if (ratio >= 0.8 && ratio <= 1.2) return 'on-target';
  if ((ratio >= 0.5 && ratio < 0.8) || (ratio > 1.2 && ratio <= 1.5)) return 'close';
  return 'off-target';
}

/**
 * Pairs a day's planned and completed workouts per sport, in the order given
 * (start time first, workouts without a start time last, then creation).
 */
export function dayItems(
  planned: readonly Workout[],
  completed: readonly Workout[],
  date: string,
  today: string,
): Item[] {
  const sports: Sport[] = ['bike', 'run'];
  const items: Item[] = [];
  for (const sport of sports) {
    const plannedOfSport = planned.filter((workout) => workout.sport === sport);
    const completedOfSport = completed.filter((workout) => workout.sport === sport);
    const pairs = Math.min(plannedOfSport.length, completedOfSport.length);
    for (let index = 0; index < pairs; index += 1) {
      const plannedWorkout = plannedOfSport[index] as Workout;
      const completedWorkout = completedOfSport[index] as Workout;
      const ratio = pairRatio(plannedWorkout, completedWorkout);
      items.push({
        planned: plannedWorkout,
        completed: completedWorkout,
        compliance: ratioState(ratio),
        ratio,
      });
    }
    for (const plannedWorkout of plannedOfSport.slice(pairs)) {
      items.push({
        planned: plannedWorkout,
        completed: null,
        compliance: date < today ? 'missed' : 'planned',
        ratio: null,
      });
    }
    for (const completedWorkout of completedOfSport.slice(pairs)) {
      items.push({ planned: null, completed: completedWorkout, compliance: 'unplanned', ratio: null });
    }
  }
  return items.sort((left, right) => itemOrder(left) - itemOrder(right));
}

function itemOrder(item: Item): number {
  const workout = item.planned ?? item.completed;
  if (!workout || workout.start_local === null) return Number.MAX_SAFE_INTEGER;
  const [hours, minutes] = workout.start_local.split(':');
  return Number(hours) * 60 + Number(minutes);
}

export function emptyTally(): WeekTally {
  return {
    'on-target': 0,
    close: 0,
    'off-target': 0,
    missed: 0,
    unplanned: 0,
    planned: 0,
  };
}

export function tallyItems(items: readonly Item[]): WeekTally {
  const tally = emptyTally();
  for (const item of items) tally[item.compliance] += 1;
  return tally;
}

/** On-target share of paired items plus missed items, or null with no denominator. */
export function onTargetPercent(items: readonly Item[]): number | null {
  const counted = items.filter(
    (item) => item.ratio !== null || item.compliance === 'missed',
  );
  if (counted.length === 0) return null;
  const onTarget = counted.filter((item) => item.compliance === 'on-target').length;
  return (onTarget / counted.length) * 100;
}
