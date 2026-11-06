const ZONE = "America/Chicago";

const wallFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

const zoneFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: ZONE,
  timeZoneName: "short",
});

export type WallClock = {
  date: string; // YYYY-MM-DD
  minutes: number; // minutes after local midnight, 0..1439
};

export const wallClock = (instant: Date): WallClock => {
  const parts = wallFormat.formatToParts(instant);
  const get = (type: string): string => {
    const part = parts.find((p) => p.type === type);
    return part ? part.value : "";
  };
  const date = `${get("year")}-${get("month")}-${get("day")}`;
  const minutes = Number(get("hour")) * 60 + Number(get("minute"));
  return { date, minutes };
};

export const zoneAbbreviation = (instant: Date): string => {
  const part = zoneFormat.formatToParts(instant).find((p) => p.type === "timeZoneName");
  const value = part ? part.value : "CST";
  // Some ICU builds label the zone "GMT-5"/"GMT-6"; map those back to the
  // abbreviations the screens publish.
  if (value === "GMT-5") return "CDT";
  if (value === "GMT-6") return "CST";
  return value;
};

export const kitchenToday = (now: Date): string => wallClock(now).date;

export const isoInstant = (instant: Date): string => instant.toISOString();

export const addDays = (date: string, days: number): string => {
  const [y, m, d] = date.split("-").map(Number);
  const t = new Date(Date.UTC(y!, m! - 1, d! + days));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(t.getUTCDate()).padStart(2, "0")}`;
};

const dayNumber = (date: string): number => {
  const [y, m, d] = date.split("-").map(Number);
  return Math.floor(Date.UTC(y!, m! - 1, d!) / 86400000);
};

const offsetAt = (instant: Date): number => {
  const wall = wallClock(instant);
  const utcParts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const uget = (type: string): string => {
    const part = utcParts.find((p) => p.type === type);
    return part ? part.value : "";
  };
  const utcDay = `${uget("year")}-${uget("month")}-${uget("day")}`;
  const utcMinOfDay = Number(uget("hour")) * 60 + Number(uget("minute"));
  const wallMinutes = wall.minutes + (dayNumber(wall.date) - dayNumber(utcDay)) * 1440;
  return wallMinutes - utcMinOfDay;
};

export const resolveWall = (date: string, minutes: number): { first: Date; second: Date | null } | null => {
  // Resolve a kitchen wall-clock time to instants. Returns null when the time
  // does not exist (the skipped spring hour). A repeated autumn hour returns
  // both occurrences, first (daylight time) then second (standard time).
  const naive = Date.UTC(
    Number(date.slice(0, 4)),
    Number(date.slice(5, 7)) - 1,
    Number(date.slice(8, 10)),
    Math.floor(minutes / 60),
    minutes % 60,
  );
  const candidates = new Set<number>();
  for (const shift of [-3600000, 0, 3600000, 43200000, 90000000]) {
    const around = new Date(naive + shift);
    candidates.add(offsetAt(around));
  }
  const matches: Date[] = [];
  for (const offset of candidates) {
    const instant = new Date(naive - offset * 60000);
    const wall = wallClock(instant);
    if (wall.date === date && wall.minutes === minutes) matches.push(instant);
  }
  matches.sort((a, b) => a.getTime() - b.getTime());
  if (matches.length === 0) return null;
  return { first: matches[0]!, second: matches.length > 1 ? matches[1]! : null };
};

// A local start or interior time means its first occurrence (daylight time).
export const localInstant = (date: string, minutes: number): Date | null => {
  if (minutes === 1440) return resolveWall(addDays(date, 1), 0)?.first ?? null;
  return resolveWall(date, minutes)?.first ?? null;
};

export const dayStartInstant = (date: string): Date | null => localInstant(date, 0);

export const localDateOfInstant = (instant: Date): string => wallClock(instant).date;

export const cancellationCutoff = (date: string, startMinutes: number): Date | null =>
  localInstant(addDays(date, -2), startMinutes);

export const zoneAtNoon = (date: string): string => {
  const noon = localInstant(date, 720);
  return noon ? zoneAbbreviation(noon) : "CST";
};

export const minutesToHHMM = (minutes: number): string => {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
};

export const hhmmToMinutes = (value: string): number | null => {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (m % 15 !== 0) return null;
  if (h > 24 || (h === 24 && m !== 0)) return null;
  return h * 60 + m;
};

export const isValidDate = (value: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const t = new Date(Date.UTC(y!, m! - 1, d!));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m! - 1 && t.getUTCDate() === d;
};

export const weekdayName = (date: string): string =>
  new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "long" }).format(
    new Date(`${date}T00:00:00Z`),
  );

export const monthName = (month: string): string =>
  new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "long" }).format(
    new Date(`${month}-01T00:00:00Z`),
  );

export const dayOfMonth = (date: string): string => String(Number(date.slice(8, 10)));

export const formatInstant = (instant: Date): string => {
  const wall = wallClock(instant);
  return `${wall.date} ${minutesToHHMM(wall.minutes)} ${zoneAbbreviation(instant)}`;
};
