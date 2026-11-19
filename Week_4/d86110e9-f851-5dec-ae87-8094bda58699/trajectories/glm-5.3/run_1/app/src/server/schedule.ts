// Schedule time resolution: "every N minutes" and "daily at HH:MM" in the
// workspace zone. Daily rules handle spring-forward (fire at the next
// existing minute) and fall-back (fire once at the first occurrence).

import { CONFIG } from "./config.js";


export type ScheduleSpec =
  | { kind: "interval"; minutes: number }
  | { kind: "daily"; hour: number; minute: number };

export function parseSchedule(s: string): ScheduleSpec | null {
  const every = /^every\s+(\d+)\s+minutes?$/i.exec(s.trim());
  if (every) {
    const n = Number(every[1]);
    if (n >= 1 && n <= 1440) return { kind: "interval", minutes: n };
    return null;
  }
  const daily = /^daily\s+at\s+(\d{1,2}):(\d{2})$/i.exec(s.trim());
  if (daily) {
    const h = Number(daily[1]);
    const m = Number(daily[2]);
    if (h <= 23 && m <= 59) return { kind: "daily", hour: h, minute: m };
    return null;
  }
  return null;
}

// Next firing strictly after `from`, in real UTC milliseconds.
export function nextAfter(spec: ScheduleSpec, fromMs: number): number {
  if (spec.kind === "interval") {
    return fromMs + spec.minutes * 60_000;
  }
  return nextDaily(spec, fromMs);
}

function nextDaily(spec: { hour: number; minute: number }, fromMs: number): number {
  // Walk forward minute by minute to the first instant whose local wall clock
  // equals the requested time. Two DST rules adjust the walk:
  // - spring forward: when the wall time does not exist on this day, fire at
  //   the first minute after the skipped hour (the next existing minute);
  // - fall back: the wall time occurs twice; fire once, at the first.
  // After a firing, continue the walk from the NEXT day so a repeated wall
  // time never fires twice.
  const zone = CONFIG.timeZone;
  const firedDay = dayKey(fromMs, zone);
  let t = alignToMinute(fromMs) + 60_000;
  // a firing consumes its local day: continue from the next local day so a
  // repeated wall time (fall back) never fires twice
  while (dayKey(t, zone) === firedDay) {
    t += 60_000;
  }
  for (let i = 0; i < 60 * 72 + 10; i++) {
    const p = wallClock(t, zone);
    if (p.hour === spec.hour && p.minute === spec.minute) return t;
    // the wall time does not exist today (spring forward): the minute after
    // the skipped hour fires
    if (p.hour > spec.hour) return t;
    t += 60_000;
  }
  return alignToMinute(fromMs) + 24 * 3600_000;
}

function dayKey(ms: number, zone: string): string {
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" });
  return fmt.format(new Date(ms));
}

function alignToMinute(t: number): number {
  const d = new Date(t);
  return t - (d.getSeconds() * 1000 + d.getMilliseconds());
}

function wallClock(t: number, zone: string): { hour: number; minute: number } {
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone: zone, hour: "2-digit", minute: "2-digit", hour12: false });
  const parts = fmt.formatToParts(new Date(t));
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? "0") % 24;
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  return { hour: h, minute: m };
}
