// Restaurant time: Europe/Lisbon wall clock, with its summer and winter offsets.
const WALL = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Lisbon",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

interface Wall {
  date: string;
  time: string;
  offsetMinutes: number;
}

function wallOf(instant: Date): Wall {
  const parts: Record<string, string> = {};
  for (const part of WALL.formatToParts(instant)) parts[part.type] = part.value;
  const wallAsUtc = Date.UTC(
    Number(parts["year"]),
    Number(parts["month"]) - 1,
    Number(parts["day"]),
    Number(parts["hour"]),
    Number(parts["minute"]),
    Number(parts["second"]),
  );
  const whole = Math.floor(instant.getTime() / 1000) * 1000;
  return {
    date: `${parts["year"]}-${parts["month"]}-${parts["day"]}`,
    time: `${parts["hour"]}:${parts["minute"]}`,
    offsetMinutes: Math.round((wallAsUtc - whole) / 60_000),
  };
}

export function lisbonDate(instant: Date): string {
  return wallOf(instant).date;
}

export function lisbonTime(instant: Date): string {
  return wallOf(instant).time;
}

/** The instant at which a Lisbon wall clock reads `date` `time`. */
export function slotInstant(date: string, time: string): Date {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const wallAsUtc = Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1, hour ?? 0, minute ?? 0);
  const first = wallOf(new Date(wallAsUtc)).offsetMinutes;
  const guess = new Date(wallAsUtc - first * 60_000);
  const second = wallOf(guess).offsetMinutes;
  return second === first ? guess : new Date(wallAsUtc - second * 60_000);
}

/** ISO 8601 with the Lisbon offset, e.g. 2026-11-14T20:30:00+00:00 */
export function isoWithLisbonOffset(instant: Date): string {
  const wall = wallOf(instant);
  const sign = wall.offsetMinutes < 0 ? "-" : "+";
  const abs = Math.abs(wall.offsetMinutes);
  const offset = `${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
  return `${wall.date}T${wall.time}:00${offset}`;
}

export function lisbonClock(instant: Date): string {
  const wall = wallOf(instant);
  const seconds = String(instant.getUTCSeconds()).padStart(2, "0");
  return `${wall.time}:${seconds}`;
}
