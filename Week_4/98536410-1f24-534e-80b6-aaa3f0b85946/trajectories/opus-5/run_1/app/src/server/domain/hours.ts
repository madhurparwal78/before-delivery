import {
  formatOffset,
  isoMillis,
  localDate,
  localParts,
  minutesOfDay,
  resolveLocal,
  timeOfMinutes,
  weekdayOf,
} from './time.js';

export type DayEntry = {
  weekday: number;
  open: boolean;
  opens: string | null;
  closes: string | null;
};

export type HoursPlan = { effectiveFrom: string; days: DayEntry[] };

export type Slot = {
  start_local: string;
  start_utc: string;
  utc_offset: string;
  remaining: 0 | 1 | 2;
};

export const SLOT_CAPACITY = 2;
const SLOT_MINUTES = 30;
export const SLOT_WINDOW_FROM_SECONDS = 7200;
export const SLOT_WINDOW_TO_SECONDS = 604800;

/** The plan governing a shop-local date: the latest plan effective on or before it. */
export function planInEffect(plans: HoursPlan[], date: string): HoursPlan {
  let chosen = plans[0] as HoursPlan;
  for (const plan of plans) {
    if (plan.effectiveFrom <= date && plan.effectiveFrom >= chosen.effectiveFrom) chosen = plan;
  }
  return chosen;
}

function dayEntryOf(plan: HoursPlan, date: string): DayEntry {
  const weekday = weekdayOf(date);
  return plan.days[weekday - 1] as DayEntry;
}

/** The earliest instant whose local wall clock on `date` reads `time` or the next time that exists. */
function firstInstantAtOrAfter(timezone: string, date: string, time: string): Date {
  for (let minutes = minutesOfDay(time); minutes <= 24 * 60; minutes += 1) {
    const found = resolveLocal(timezone, date, timeOfMinutes(Math.min(minutes, 1439)));
    if (found.length > 0 && minutes <= 1439) return found[0]!.instant;
  }
  return resolveLocal(timezone, date, '12:00')[0]!.instant;
}

export type DayPlan = {
  date: string;
  timezone: string;
  open: boolean;
  opens_local: string | null;
  closes_local: string | null;
  opens_utc: string | null;
  closes_utc: string | null;
  slots: Slot[];
};

/**
 * Every slot of a local date: half-hour starts inside the day's hours, each local start
 * offered once and only when it exists locally that day.
 */
export function dayPlanFor(
  timezone: string,
  plans: HoursPlan[],
  date: string,
  remainingOf: (startUtc: string) => 0 | 1 | 2,
): DayPlan {
  const day = dayEntryOf(planInEffect(plans, date), date);
  if (!day.open || day.opens === null || day.closes === null) {
    return {
      date,
      timezone,
      open: false,
      opens_local: null,
      closes_local: null,
      opens_utc: null,
      closes_utc: null,
      slots: [],
    };
  }

  const opensAt = minutesOfDay(day.opens);
  const closesAt = minutesOfDay(day.closes);
  const slots: Slot[] = [];
  for (let minutes = opensAt; minutes + SLOT_MINUTES <= closesAt; minutes += SLOT_MINUTES) {
    const startLocal = timeOfMinutes(minutes);
    const candidates = resolveLocal(timezone, date, startLocal);
    const earliest = candidates[0];
    if (!earliest) continue;
    const startUtc = isoMillis(earliest.instant);
    slots.push({
      start_local: startLocal,
      start_utc: startUtc,
      utc_offset: formatOffset(earliest.offsetMinutes),
      remaining: remainingOf(startUtc),
    });
  }

  return {
    date,
    timezone,
    open: true,
    opens_local: day.opens,
    closes_local: day.closes,
    opens_utc: isoMillis(firstInstantAtOrAfter(timezone, date, day.opens)),
    closes_utc: isoMillis(firstInstantAtOrAfter(timezone, date, day.closes)),
    slots,
  };
}

export type DisplayState = 'open' | 'closing_soon' | 'closed' | 'stock_critical' | 'suspended';

export const STATE_LABELS: Readonly<Record<DisplayState, string>> = {
  open: 'Open',
  closing_soon: 'Closing soon',
  closed: 'Closed',
  stock_critical: 'Stock critical',
  suspended: 'Suspended',
};

export const DISPLAY_STATES: readonly DisplayState[] = [
  'open',
  'closing_soon',
  'closed',
  'stock_critical',
  'suspended',
];

export function isDisplayState(value: string): value is DisplayState {
  return (DISPLAY_STATES as readonly string[]).includes(value);
}

const CLOSING_SOON_MINUTES = 30;

/**
 * The one place the display state precedence lives: suspended beats stock critical,
 * which beats closing soon, which beats open or closed.
 */
export function displayStateOf(input: {
  timezone: string;
  plans: HoursPlan[];
  now: Date;
  suspended: boolean;
  criticalLines: number;
}): { displayState: DisplayState; closesLocal: string | null } {
  const today = localDate(input.timezone, input.now);
  const day = dayEntryOf(planInEffect(input.plans, today), today);
  const closesLocal = day.open ? day.closes : null;

  if (input.suspended) return { displayState: 'suspended', closesLocal };
  if (input.criticalLines > 0) return { displayState: 'stock_critical', closesLocal };

  if (!day.open || day.opens === null || day.closes === null) {
    return { displayState: 'closed', closesLocal };
  }

  const parts = localParts(input.timezone, input.now);
  const nowMinutes = parts.hour * 60 + parts.minute;
  const opensAt = minutesOfDay(day.opens);
  const closesAt = minutesOfDay(day.closes);

  if (nowMinutes < opensAt || nowMinutes >= closesAt) {
    return { displayState: 'closed', closesLocal };
  }
  if (nowMinutes >= closesAt - CLOSING_SOON_MINUTES) {
    return { displayState: 'closing_soon', closesLocal };
  }
  return { displayState: 'open', closesLocal };
}
