import { addDays, type PlainDate } from './dates';

export type DailyResultState = 'solved' | 'late';

export type DayState = 'solved' | 'late' | 'missed' | 'today' | 'future' | 'closed';

export const DAY_STATE_WORDS: Record<DayState, string> = {
  solved: 'solved',
  late: 'solved late',
  missed: 'missed',
  today: 'today',
  future: 'not open yet',
  closed: 'not available',
};

export function dayState(
  date: PlainDate,
  today: PlainDate,
  dailyStart: PlainDate,
  result: DailyResultState | null,
): DayState {
  if (date < dailyStart) return 'closed';
  if (date > today) return 'future';
  if (result === 'solved') return 'solved';
  if (result === 'late') return 'late';
  if (date === today) return 'today';
  return 'missed';
}

export function isOpenDayState(state: DayState): boolean {
  return state === 'solved' || state === 'late' || state === 'missed' || state === 'today';
}

/** Consecutive solved dates ending today if today is solved, else yesterday. */
export function currentStreak(solved: ReadonlySet<PlainDate>, today: PlainDate): number {
  let cursor = solved.has(today) ? today : addDays(today, -1);
  let streak = 0;
  while (solved.has(cursor)) {
    streak += 1;
    cursor = addDays(cursor, -1);
  }
  return streak;
}

/** The longest run of consecutive solved dates ever. */
export function bestStreak(solved: ReadonlySet<PlainDate>): number {
  let best = 0;
  for (const date of solved) {
    if (solved.has(addDays(date, -1))) continue;
    let run = 0;
    let cursor: PlainDate = date;
    while (solved.has(cursor)) {
      run += 1;
      cursor = addDays(cursor, 1);
    }
    if (run > best) best = run;
  }
  return best;
}
