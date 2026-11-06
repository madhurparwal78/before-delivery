/**
 * Minimal IANA timezone engine backed by the Intl API.
 * All dates here are local calendar dates in a zone, represented as YYYY-MM-DD strings.
 */

export type ZoneOffsets = { date: string; offset: string }[];

const dtfCache = new Map<string, { locale: string; dtf: Intl.DateTimeFormat }>();

function utcDtf(zone: string): Intl.DateTimeFormat {
  let entry = dtfCache.get(zone);
  if (!entry) {
    entry = {
      locale: "en-US",
      dtf: new Intl.DateTimeFormat("en-US", {
        timeZone: zone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      }),
    };
    dtfCache.set(zone, entry);
  }
  return entry.dtf;
}

export function validZone(zone: string): boolean {
  if (typeof zone !== "string" || zone.length === 0 || zone.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** The local calendar date in the zone for the given instant, plus the zone's offset string. */
export function partsFor(zone: string, ms: number): { date: string; offset: string; hour: number; minute: number } {
  const dtf = utcDtf(zone);
  const parts = dtf.formatToParts(new Date(ms));
  const get = (t: string): string => {
    const p = parts.find((x) => x.type === t);
    return p ? p.value : "";
  };
  let hour = Number(get("hour"));
  if (hour === 24) hour = 0;
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    offset: get("timeZoneName") === "" ? "" : offsetOfMs(zone, ms),
    hour,
    minute: Number(get("minute")),
  };
}

export function offsetOfMs(zone: string, ms: number): string {
  const dtf = utcDtf(zone);
  ms = Math.floor(ms / 1000) * 1000;
  const parts = dtf.formatToParts(new Date(ms));
  let year = "";
  let month = "";
  let day = "";
  let hour = "";
  let minute = "";
  let second = "";
  for (const p of parts) {
    if (p.type === "year") year = p.value;
    else if (p.type === "month") month = p.value;
    else if (p.type === "day") day = p.value;
    else if (p.type === "hour") hour = p.value;
    else if (p.type === "minute") minute = p.value;
    else if (p.type === "second") second = p.value;
  }
  const asUTC = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second));
  return offsetString((asUTC - ms) / 1000);
}

function offsetString(deltaSeconds: number): string {
  const sign = deltaSeconds < 0 ? "-" : "+";
  const abs = Math.abs(Math.round(deltaSeconds / 60));
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `${sign}${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * The instant of local midnight for a date in a zone, resolving the two edge rules:
 * - if 00:00 does not exist, the first instant after the gap;
 * - if 00:00 happens twice, the earlier instance.
 */
export function localMidnightInstant(zone: string, date: string): number {
  const ymd = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)!;
  const base = Date.UTC(Number(ymd[1]), Number(ymd[2]) - 1, Number(ymd[3]));

  // Offset at start of day and end of day to bracket what midnight could be.
  const startGuess = offsetMinutes(zone, base) * 60000;
  const dayAfter = base + 86400000;
  const endGuess = offsetMinutes(zone, dayAfter) * 60000;

  // Candidate instants: interpret 00:00 with each possible offset.
  const candidates = new Set<number>([base - startGuess, base - endGuess]);
  let best = base - startGuess;
  let found = false;
  for (const cand of candidates) {
    if (cand > 0) {
      const p = partsFor(zone, cand);
      if (p.date === date && p.hour === 0 && p.minute === 0) {
        if (!found || cand < best) {
          best = cand;
          found = true;
        }
      }
    }
  }
  if (found) return best;

  // 00:00 does not exist (a forward gap crossed midnight): scan minute by minute for
  // the first instant that is on this date, which by construction is just after the gap.
  const lo = base - Math.max(startGuess, endGuess) - 7200000;
  let probe = lo;
  while (probe < lo + 5 * 3600000) {
    const p = partsFor(zone, probe);
    if (p.date === date) return probe;
    probe += 60000;
  }
  return base - startGuess;
}

function offsetMinutes(zone: string, ms: number): number {
  const dtf = utcDtf(zone);
  ms = Math.floor(ms / 1000) * 1000;
  const parts = dtf.formatToParts(new Date(ms));
  let year = "";
  let month = "";
  let day = "";
  let hour = "";
  let minute = "";
  let second = "";
  for (const p of parts) {
    if (p.type === "year") year = p.value;
    else if (p.type === "month") month = p.value;
    else if (p.type === "day") day = p.value;
    else if (p.type === "hour") hour = p.value;
    else if (p.type === "minute") minute = p.value;
    else if (p.type === "second") second = p.value;
  }
  const asUTC = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second));
  return Math.round((asUTC - ms) / 60000);
}

/** The offset in force during the local date, as seconds east of UTC. */
export function zoneOffsetSeconds(zone: string, date: string): number {
  const mid = localMidnightInstant(zone, date);
  return offsetMinutes(zone, mid) * 60;
}

/** 'forward' when the offset grew across the date, 'back' when it shrank, null when same. */
export function clockChange(zone: string, date: string): "forward" | "back" | null {
  const ymd = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)!;
  const base = Date.UTC(Number(ymd[1]), Number(ymd[2]) - 1, Number(ymd[3]));
  const before = offsetMinutes(zone, base - 1) * 60;
  const after = offsetMinutes(zone, base + 86400000 - 1) * 60;
  if (after > before) return "forward";
  if (after < before) return "back";
  return null;
}

/** Format an instant in a zone as an ISO 8601 instant with the zone's offset. */
export function instantInZone(zone: string, ms: number): string {
  const dtf = utcDtf(zone);
  const parts = dtf.formatToParts(new Date(ms));
  const get = (t: string): string => {
    const p = parts.find((x) => x.type === t);
    return p ? p.value : "";
  };
  let hour = get("hour");
  if (hour === "24") hour = "00";
  return `${get("year")}-${get("month")}-${get("day")}T${hour}:${get("minute")}:${get("second")}${offsetOfMs(zone, ms)}`;
}

/** The instant of a local wall-clock time on a date, first instance. */
export function localTimeInstant(zone: string, date: string, hour: number, minute: number): number {
  const ymd = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)!;
  const base = Date.UTC(Number(ymd[1]), Number(ymd[2]) - 1, Number(ymd[3]), hour, minute);
  const off = offsetMinutes(zone, base) * 60000;
  let candidate = base - off;
  const p = partsFor(zone, candidate);
  if (p.date === date && p.hour === hour && p.minute === minute) return candidate;
  // try the other side of a possible transition
  const off2 = offsetMinutes(zone, base + 86400000) * 60000;
  candidate = base - off2;
  const p2 = partsFor(zone, candidate);
  if (p2.date === date && p2.hour === hour && p2.minute === minute) return candidate;
  return base - off;
}
