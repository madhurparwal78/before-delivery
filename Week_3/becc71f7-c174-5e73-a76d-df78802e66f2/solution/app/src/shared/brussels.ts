// The one home of Brussels wall-clock arithmetic: every day boundary in the product goes through here.

const WALL_CLOCK = new Intl.DateTimeFormat("en-US", {
  timeZone: "Europe/Brussels",
  hourCycle: "h23",
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "numeric",
  second: "numeric",
});

interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

export function wallClock(instant: Date): WallClock {
  const clock: WallClock = { year: 0, month: 0, day: 0, hour: 0, minute: 0, second: 0 };
  for (const part of WALL_CLOCK.formatToParts(instant)) {
    if (part.type === "year" || part.type === "month" || part.type === "day" || part.type === "hour" || part.type === "minute" || part.type === "second") {
      clock[part.type] = Number(part.value);
    }
  }
  return clock;
}

const pad = (value: number, width = 2): string => String(value).padStart(width, "0");

export function brusselsDate(instant: Date): string {
  const { year, month, day } = wallClock(instant);
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}`;
}

export function brusselsMonth(instant: Date): string {
  return brusselsDate(instant).slice(0, 7);
}

/** The instant at which Brussels clocks show this date and time. */
export function brusselsInstant(date: string, hour = 0, minute = 0, second = 0): Date {
  const [year, month, day] = date.split("-").map(Number);
  const target = Date.UTC(year, month - 1, day, hour, minute, second);
  let guess = target;
  for (let round = 0; round < 2; round += 1) {
    const shown = wallClock(new Date(guess));
    const shownUtc = Date.UTC(shown.year, shown.month - 1, shown.day, shown.hour, shown.minute, shown.second);
    guess += target - shownUtc;
  }
  return new Date(guess);
}

export function addDays(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/** Monday is 0, Sunday is 6. */
export function weekdayIndex(date: string): number {
  return (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7;
}

export function addMonths(month: string, months: number): string {
  const [year, number] = month.split("-").map(Number);
  const index = year * 12 + number - 1 + months;
  return `${pad(Math.floor(index / 12), 4)}-${pad((index % 12) + 1)}`;
}

/** The instants at which a Brussels month starts and ends. */
export function monthBounds(month: string): [Date, Date] {
  return [brusselsInstant(`${month}-01`), brusselsInstant(`${addMonths(month, 1)}-01`)];
}
