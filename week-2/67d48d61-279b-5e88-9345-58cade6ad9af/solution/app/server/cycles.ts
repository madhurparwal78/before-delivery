// Rehearsal-week cycles and the opening-night countdown, in the theatre's time zone.
// The current cycle is decided here and nowhere else.

import { CYCLES, type CycleKey } from "../shared/catalog.js";
import { config } from "./config.js";

const DAY_MS = 86_400_000;

export interface CycleAnchor {
  firstStart: Date;
  firstMonday: string;
}

export interface CycleWindow {
  key: CycleKey;
  name: string;
  start: Date;
  end: Date | null;
}

const zoneParts = (instant: Date, timeZone: string): Record<string, number> => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  return Object.fromEntries(parts.filter((p) => p.type !== "literal").map((p) => [p.type, Number(p.value)]));
};

const zoneOffset = (instant: Date, timeZone: string): number => {
  const p = zoneParts(instant, timeZone);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(instant.getTime() / 1000) * 1000;
};

export const localDate = (instant: Date, timeZone = config.timeZone): string => {
  const p = zoneParts(instant, timeZone);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
};

const dateToUtcMs = (date: string): number => {
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
};

const addDays = (date: string, days: number): string =>
  new Date(dateToUtcMs(date) + days * DAY_MS).toISOString().slice(0, 10);

export const daysBetween = (from: string, to: string): number => Math.round((dateToUtcMs(to) - dateToUtcMs(from)) / DAY_MS);

export const mondayOf = (date: string): string => addDays(date, -((new Date(dateToUtcMs(date)).getUTCDay() + 6) % 7));

const midnightIn = (date: string, timeZone: string): Date => {
  const guess = dateToUtcMs(date);
  let instant = guess - zoneOffset(new Date(guess), timeZone);
  instant = guess - zoneOffset(new Date(instant), timeZone);
  return new Date(instant);
};

export const cycleWindows = (anchor: CycleAnchor): CycleWindow[] => {
  const starts = CYCLES.map((_, i) =>
    config.cycleSeconds !== null
      ? new Date(anchor.firstStart.getTime() + i * config.cycleSeconds * 1000)
      : midnightIn(addDays(config.firstMonday ?? anchor.firstMonday, 7 * i), config.timeZone),
  );
  return CYCLES.map((cycle, i) => ({ key: cycle.key, name: cycle.name, start: starts[i], end: starts[i + 1] ?? null }));
};

const currentCycleIndex = (windows: CycleWindow[], now = new Date()): number => {
  let index = 0;
  windows.forEach((w, i) => {
    if (w.start.getTime() <= now.getTime()) index = i;
  });
  return index;
};

export const openingNight = (anchor: CycleAnchor): string =>
  config.openingNight ?? addDays(config.firstMonday ?? anchor.firstMonday, 38);

// The anchor and the cycles it spans are recorded in Postgres on the first start and read once at boot.
let recorded!: { anchor: CycleAnchor; windows: CycleWindow[] };

export const useCycles = (anchor: CycleAnchor, windows: CycleWindow[]): void => {
  recorded = { anchor, windows };
};

export const calendar = (): { anchor: CycleAnchor; windows: CycleWindow[]; current: number } => ({
  ...recorded,
  current: currentCycleIndex(recorded.windows),
});
