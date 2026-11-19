import { instantOfWallClock, startOfZoneDayAfter, wallClockOf } from './time';

export type Schedule = { kind: 'interval'; minutes: number } | { kind: 'daily'; hour: number; minute: number };

const INTERVAL = /^every (\d+) minutes?$/;
const DAILY = /^daily at (\d{2}):(\d{2})$/;

export function parseSchedule(text: unknown): Schedule | null {
  if (typeof text !== 'string') return null;
  const trimmed = text.trim();
  const interval = INTERVAL.exec(trimmed);
  if (interval) {
    const minutes = Number(interval[1]);
    if (minutes >= 1 && minutes <= 1440) return { kind: 'interval', minutes };
    return null;
  }
  const daily = DAILY.exec(trimmed);
  if (daily) {
    const hour = Number(daily[1]);
    const minute = Number(daily[2]);
    if (hour <= 23 && minute <= 59) return { kind: 'daily', hour, minute };
    return null;
  }
  return null;
}

/** The first firing after an anchor instant (the publish moment). */
export function firstFiring(schedule: Schedule, anchor: Date): Date {
  if (schedule.kind === 'interval') return new Date(anchor.getTime() + schedule.minutes * 60_000);
  const wall = wallClockOf(anchor);
  const today = instantOfWallClock({
    year: wall.year,
    month: wall.month,
    day: wall.day,
    hour: schedule.hour,
    minute: schedule.minute,
  });
  if (today.getTime() > anchor.getTime()) return today;
  return dailyOnNextDay(schedule, anchor);
}

function dailyOnNextDay(schedule: { hour: number; minute: number }, after: Date): Date {
  const nextDay = startOfZoneDayAfter(after);
  return instantOfWallClock({ ...nextDay, hour: schedule.hour, minute: schedule.minute });
}

/** The firing after a previous scheduled instant. */
export function nextFiring(schedule: Schedule, previous: Date): Date {
  if (schedule.kind === 'interval') return new Date(previous.getTime() + schedule.minutes * 60_000);
  return dailyOnNextDay(schedule, previous);
}
