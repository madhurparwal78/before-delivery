import { mondayOfWeekContaining } from './time.js';

export type BlockKind = 'drive' | 'break' | 'wait' | 'rest';
export type Block = { kind: BlockKind; minutes: number };
export type BreachRule = 'drivingBeforeBreak' | 'dailyDriving' | 'spread';
export type Breach = { rule: BreachRule; atMinute: number };

export const DRIVING_BEFORE_BREAK_LIMIT = 270;
export const BREAK_MINUTES = 45;
export const SPLIT_FIRST_MINUTES = 15;
export const SPLIT_SECOND_MINUTES = 30;
export const DAILY_DRIVING_LIMIT = 540;
export const DAILY_DRIVING_HIGHER_LIMIT = 600;
export const DAILY_DRIVING_HIGHER_DAYS = 2;
export const SPREAD_LIMIT = 780;

export function drivingMinutesOf(blocks: Block[]): number {
  return blocks.filter((block) => block.kind === 'drive').reduce((sum, block) => sum + block.minutes, 0);
}

export function spreadMinutesOf(blocks: Block[]): number {
  return blocks.reduce((sum, block) => sum + block.minutes, 0);
}

/** The elapsed minute of duty at which driving since the last break passes its limit. */
export function drivingBeforeBreakBreach(blocks: Block[]): number | null {
  let elapsed = 0;
  let since = 0;
  let firstPartTaken = false;
  for (const block of blocks) {
    if (block.kind === 'drive') {
      for (let minute = 0; minute < block.minutes; minute += 1) {
        elapsed += 1;
        since += 1;
        if (since > DRIVING_BEFORE_BREAK_LIMIT) return elapsed;
      }
      continue;
    }
    if (block.kind === 'break') {
      if (block.minutes >= BREAK_MINUTES || (firstPartTaken && block.minutes >= SPLIT_SECOND_MINUTES)) {
        since = 0;
        firstPartTaken = false;
      } else if (block.minutes >= SPLIT_FIRST_MINUTES) {
        firstPartTaken = true;
      }
    }
    elapsed += block.minutes;
  }
  return null;
}

export function spreadBreach(blocks: Block[]): number | null {
  const spread = spreadMinutesOf(blocks);
  return spread > SPREAD_LIMIT ? SPREAD_LIMIT + 1 : null;
}

export type DutyRun = {
  id: string;
  driverKey: string | null;
  dutyDate: string;
  dutyStart: number;
  blocks: Block[];
  secondDriver: boolean;
};

/** The driving limit for each date of one driver, by the Monday-to-Sunday week rule. */
function dailyLimitFor(runs: DutyRun[], date: string): number {
  const monday = mondayOfWeekContaining(date);
  const totals = new Map<string, number>();
  for (const run of runs) {
    if (mondayOfWeekContaining(run.dutyDate) !== monday) continue;
    totals.set(run.dutyDate, (totals.get(run.dutyDate) ?? 0) + drivingMinutesOf(run.blocks));
  }
  const over = [...totals.entries()]
    .filter(([, minutes]) => minutes > DAILY_DRIVING_LIMIT)
    .map(([day]) => day)
    .sort();
  const place = over.indexOf(date);
  if (place === -1 || place < DAILY_DRIVING_HIGHER_DAYS) return DAILY_DRIVING_HIGHER_LIMIT;
  return DAILY_DRIVING_LIMIT;
}

/** The day's driving breach, reported only on the run holding the minute that passes the limit. */
export function dailyDrivingBreach(asked: DutyRun, deskRuns: DutyRun[]): number | null {
  if (asked.secondDriver) return null;
  const sameDriver = asked.driverKey
    ? deskRuns.filter((run) => !run.secondDriver && run.driverKey === asked.driverKey)
    : [asked];
  const limit = dailyLimitFor(sameDriver, asked.dutyDate);
  const onDay = sameDriver
    .filter((run) => run.dutyDate === asked.dutyDate)
    .sort((a, b) => a.dutyStart - b.dutyStart || (a.id < b.id ? -1 : 1));
  const dayTotal = onDay.reduce((sum, run) => sum + drivingMinutesOf(run.blocks), 0);
  if (dayTotal <= limit) return null;
  const breachingMinute = limit + 1;
  let before = 0;
  for (const run of onDay) {
    const driving = drivingMinutesOf(run.blocks);
    if (before + driving >= breachingMinute) {
      if (run.id !== asked.id) return null;
      return elapsedMinuteOfDrivingMinute(run.blocks, breachingMinute - before);
    }
    before += driving;
  }
  return null;
}

/** The elapsed minute of duty at which a run's nth driving minute falls. */
export function elapsedMinuteOfDrivingMinute(blocks: Block[], drivingMinute: number): number {
  let elapsed = 0;
  let driving = 0;
  for (const block of blocks) {
    if (block.kind === 'drive') {
      for (let minute = 0; minute < block.minutes; minute += 1) {
        elapsed += 1;
        driving += 1;
        if (driving === drivingMinute) return elapsed;
      }
      continue;
    }
    elapsed += block.minutes;
  }
  return elapsed;
}

export function breachesOf(asked: DutyRun, deskRuns: DutyRun[]): Breach[] {
  if (asked.secondDriver) return [];
  const breaches: Breach[] = [];
  const before = drivingBeforeBreakBreach(asked.blocks);
  if (before !== null) breaches.push({ rule: 'drivingBeforeBreak', atMinute: before });
  const daily = dailyDrivingBreach(asked, deskRuns);
  if (daily !== null) breaches.push({ rule: 'dailyDriving', atMinute: daily });
  const spread = spreadBreach(asked.blocks);
  if (spread !== null) breaches.push({ rule: 'spread', atMinute: spread });
  return breaches;
}
