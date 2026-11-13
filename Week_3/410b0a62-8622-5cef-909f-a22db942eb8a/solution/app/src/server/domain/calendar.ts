import type { Compliance, Item, Sport, Tally, Workout } from '../../shared/types.js';
import { emptyTally } from '../../shared/compliance.js';

/** A stored workout with the order it was created in. */
export interface Stored {
  workout: Workout;
  seq: number;
}

const NO_START = '99:99';

function byStartThenCreation(a: Stored, b: Stored): number {
  const left = a.workout.start_local ?? NO_START;
  const right = b.workout.start_local ?? NO_START;
  return left === right ? a.seq - b.seq : left < right ? -1 : 1;
}

function stateOf(ratio: number): Compliance {
  if (ratio >= 0.8 && ratio <= 1.2) return 'on-target';
  if (ratio >= 0.5 && ratio <= 1.5) return 'close';
  return 'off-target';
}

function ratioOf(planned: Workout, completed: Workout): number {
  return planned.planned_tss !== null && completed.tss !== null
    ? completed.tss / planned.planned_tss
    : completed.duration_s / planned.duration_s;
}

/** The items of one local day: planned and completed workouts of a sport paired in order. */
export function itemsOfDay(rows: readonly Stored[], date: string, today: string): Item[] {
  const items: { item: Item; order: Stored }[] = [];
  for (const sport of ['bike', 'run'] satisfies Sport[]) {
    const planned = rows.filter((row) => row.workout.kind === 'planned' && row.workout.sport === sport).sort(byStartThenCreation);
    const completed = rows.filter((row) => row.workout.kind === 'completed' && row.workout.sport === sport).sort(byStartThenCreation);
    for (let index = 0; index < Math.max(planned.length, completed.length); index++) {
      const plan = planned[index];
      const done = completed[index];
      if (plan && done) {
        const ratio = ratioOf(plan.workout, done.workout);
        items.push({ item: { planned: plan.workout, completed: done.workout, compliance: stateOf(ratio), ratio }, order: plan });
      } else if (plan) {
        items.push({ item: { planned: plan.workout, completed: null, compliance: date < today ? 'missed' : 'planned', ratio: null }, order: plan });
      } else if (done) {
        items.push({ item: { planned: null, completed: done.workout, compliance: 'unplanned', ratio: null }, order: done });
      }
    }
  }
  return items.sort((a, b) => byStartThenCreation(a.order, b.order)).map(({ item }) => item);
}

export function tallyOf(items: readonly Item[]): Tally {
  const tally = emptyTally();
  for (const item of items) tally[item.compliance] += 1;
  return tally;
}
