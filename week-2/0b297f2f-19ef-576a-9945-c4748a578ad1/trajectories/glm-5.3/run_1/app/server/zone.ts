/**
 * Small self-contained timezone helper. Handles fixed-offset zones and the
 * Europe/London rules from 1971 onwards (BST from late March to late October,
 * following the 1998 EU harmonised rule), which is all this app needs for
 * museum-time display and wall-clock publish times.
 */

export interface ZoneRule {
  year: number; // from which year the rule applies
  start: [month: number, day: number, dayOfWeek: number, hour: number]; // local standard time
  end: [month: number, day: number, dayOfWeek: number, hour: number]; // local daylight time
  offsetStd: number; // minutes east of UTC
  offsetDst: number;
}

const LONDON_RULE: ZoneRule = {
  year: 1998,
  start: [3, -1, 0, 1], // last Sunday in March at 01:00
  end: [10, -1, 0, 1], // last Sunday in October at 01:00
  offsetStd: 0,
  offsetDst: 60,
};

const LONDON_EARLY_RULE: ZoneRule = {
  ...LONDON_RULE,
  year: 1972,
  start: [3, -3, 0, 2], // third Sunday in March at 02:00 (approximation of 1972-1980 rules)
  end: [10, -4, 0, 2], // fourth Sunday in October at 02:00
};

function ruleForYear(year: number): ZoneRule {
  return year >= 1998 ? LONDON_RULE : LONDON_EARLY_RULE;
}

/** weekday: 0=Sunday..6=Saturday. negative weekOfMonth counts from the end. */
function nthWeekdayOfMonth(
  year: number, month: number, dayOfWeek: number, weekOfMonth: number
): number {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const offset = (dayOfWeek - first.getUTCDay() + 7) % 7;
  if (weekOfMonth > 0) return 1 + offset + (weekOfMonth - 1) * 7;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const lastDay = daysInMonth - ((first.getUTCDay() + daysInMonth - 1 - dayOfWeek + 7) % 7);
  return lastDay + (weekOfMonth + 1) * 7;
}

function transitionUtc(
  year: number, part: [number, number, number, number], baseOffsetMinutes: number
): number {
  const [month, week, dow, hour] = part;
  const day = nthWeekdayOfMonth(year, month, dow, week);
  return Date.UTC(year, month - 1, day, hour, 0, 0) - baseOffsetMinutes * 60_000;
}

export function zoneOffsetMinutes(zone: string, at: Date): number {
  if (zone === 'UTC' || zone === 'Etc/UTC') return 0;
  if (zone === 'Europe/London') {
    const year = at.getUTCFullYear();
    const rule = ruleForYear(year);
    const start = transitionUtc(year, rule.start, rule.offsetStd);
    const end = transitionUtc(year, rule.end, rule.offsetStd);
    const t = at.getTime();
    return t >= start && t < end ? rule.offsetDst : rule.offsetStd;
  }
  const fixed = /^([+-])(\d{2}):?(\d{2})$/.exec(zone);
  if (fixed) {
    const sign = fixed[1] === '-' ? -1 : 1;
    return sign * (Number(fixed[2]) * 60 + Number(fixed[3]));
  }
  return 0;
}

export interface ZonedParts {
  year: number; month: number; day: number;
  hour: number; minute: number; weekday: number; // 0=Sunday
}

export function toZonedParts(zone: string, at: Date): ZonedParts {
  const shifted = new Date(at.getTime() + zoneOffsetMinutes(zone, at) * 60_000);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    weekday: shifted.getUTCDay(),
  };
}

/** A UTC Date for a wall-clock time in the zone, resolved for DST edges. */
export function fromZonedParts(
  zone: string, year: number, month: number, day: number, hour: number, minute: number
): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const firstOffset = zoneOffsetMinutes(zone, new Date(guess));
  let utc = guess - firstOffset * 60_000;
  const checkOffset = zoneOffsetMinutes(zone, new Date(utc));
  if (checkOffset !== firstOffset) utc = guess - checkOffset * 60_000;
  return new Date(utc);
}
