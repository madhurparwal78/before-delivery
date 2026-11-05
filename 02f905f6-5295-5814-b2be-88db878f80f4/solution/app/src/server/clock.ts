// Studio time (America/Chicago), the firing schedule and every time-dependent status, all from the
// server's own clock.
import type { FiringStatus, PieceStatus, Segment } from "../shared/api";
import { config } from "./config";

const ZONE = "America/Chicago";

const labelParts = new Intl.DateTimeFormat("en-US", {
  timeZone: ZONE,
  weekday: "short",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

const dateParts = new Intl.DateTimeFormat("en-US", {
  timeZone: ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function part(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): string {
  return parts.find((p) => p.type === type)?.value ?? "";
}

/** A studio time label such as `Sat 9:15 PM`. */
export function studioLabel(at: Date): string {
  const parts = labelParts.formatToParts(at);
  return `${part(parts, "weekday")} ${part(parts, "hour")}:${part(parts, "minute")} ${part(parts, "dayPeriod").toUpperCase()}`;
}

/** The studio date `YYYY-MM-DD` of an instant. */
export function studioDate(at: Date): string {
  const parts = dateParts.formatToParts(at);
  return `${part(parts, "year")}-${part(parts, "month")}-${part(parts, "day")}`;
}

/** `{name: ISO instant, name_label: studio label}`, both null when the time is unset. */
export function timeFields<K extends string>(name: K, at: Date | null): Record<K | `${K}_label`, string | null> {
  return {
    [name]: at ? at.toISOString() : null,
    [`${name}_label`]: at ? studioLabel(at) : null,
  } as Record<K | `${K}_label`, string | null>;
}

const START_F = 70;

/** Firing hours as an exact fraction: the sum of |target − previous| ÷ rate plus hold ÷ 60. */
function firingHoursFraction(segments: readonly Segment[]): { num: bigint; den: bigint } {
  let num = 0n;
  let den = 1n;
  let previous = START_F;
  for (const segment of segments) {
    const rise = BigInt(Math.abs(segment.target_f - previous));
    const rate = BigInt(segment.rate_f_per_hour);
    num = num * rate * 60n + rise * 60n * den + BigInt(segment.hold_minutes) * rate * den;
    den = den * rate * 60n;
    previous = segment.target_f;
  }
  return { num, den };
}

/** Firing hours written with four decimals, rounded half up. */
export function firingHoursText(segments: readonly Segment[]): string {
  const { num, den } = firingHoursFraction(segments);
  const scaled = (num * 10000n * 2n + den) / (den * 2n);
  const whole = scaled / 10000n;
  return `${whole}.${(scaled % 10000n).toString().padStart(4, "0")}`;
}

interface Schedule {
  firingEndsAt: Date;
  coolUntil: Date;
}

/** End of firing and opening of unload, from the profile snapshot and the studio hour length. */
export function schedule(start: Date, segments: readonly Segment[], coolDownHours: number): Schedule {
  const { num, den } = firingHoursFraction(segments);
  const firingMs = Math.round((Number(num) / Number(den)) * config.hourMs);
  const firingEndsAt = new Date(start.getTime() + firingMs);
  return { firingEndsAt, coolUntil: new Date(firingEndsAt.getTime() + coolDownHours * config.hourMs) };
}

export const FIRING_LABELS: Record<FiringStatus, string> = {
  building: "Building load",
  firing: "Firing",
  cooling: "Kiln still cooling",
  unloadable: "Ready to unload",
  unloaded: "Unloaded",
};

export const PIECE_LABELS: Record<PieceStatus, string> = {
  awaiting_payment: "Awaiting payment",
  queued: "Waiting for kiln",
  loaded: "Loaded in kiln",
  firing: "Firing",
  cooling: "Kiln still cooling",
  unloadable: "Cooled, waiting to unload",
  ready: "Ready on pickup shelf",
  collected: "Collected",
  uncollected: "Uncollected",
};

interface FiringClock {
  status: "building" | "started" | "unloaded";
  firing_ends_at: Date | null;
  cool_until: Date | null;
}

/** The cool-down decision: firing until `firing_ends_at`, cooling until `cool_until`, then unloadable. */
export function firingStatus(firing: FiringClock, now: Date): FiringStatus {
  if (firing.status === "building") return "building";
  if (firing.status === "unloaded") return "unloaded";
  if (firing.firing_ends_at && now < firing.firing_ends_at) return "firing";
  if (firing.cool_until && now < firing.cool_until) return "cooling";
  return "unloadable";
}

export type StoredPieceStatus = "awaiting_payment" | "queued" | "loaded" | "ready" | "collected" | "uncollected";

/** A placed piece takes firing, cooling and unloadable from its firing. */
export function pieceStatus(stored: StoredPieceStatus, firing: FiringStatus | null): PieceStatus {
  if (stored !== "loaded" || firing === null || firing === "building" || firing === "unloaded") return stored;
  return firing;
}

/** Whole studio days since a piece reached the pickup shelf. */
export function daysOnShelf(readyAt: Date, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - readyAt.getTime()) / config.dayMs));
}

export const REMINDER_DAYS = 14;
export const LAPSE_DAYS = 21;

/** The instant before which a piece that became ready has been on the shelf `days` studio days. */
export function shelfThreshold(now: Date, days: number): Date {
  return new Date(now.getTime() - days * config.dayMs);
}
