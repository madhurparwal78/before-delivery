import { db } from "./db.js";
import { config } from "./config.js";

export interface WallTime {
  now: Date;
  epochMs: number;
}

interface ClockRow {
  workspace_id: string;
  base_epoch: string;
}

const clockCache = new Map<string, { base: number; setAt: number }>();
let cacheFilled = 0;

async function loadClocks(): Promise<void> {
  if (cacheFilled !== 0 && Date.now() - cacheFilled < 1000) return;
  const rows = await db.all<ClockRow>("select workspace_id, base_epoch from grading_clocks");
  for (const row of rows) {
    const existing = clockCache.get(row.workspace_id);
    if (!existing) clockCache.set(row.workspace_id, { base: Number(row.base_epoch), setAt: Date.now() });
  }
  cacheFilled = Date.now();
}

export async function setGradingClock(workspaceId: string, now: Date): Promise<void> {
  await db.run(
    "insert into grading_clocks (workspace_id, base_epoch) values ($1, $2) " +
      "on conflict (workspace_id) do update set base_epoch = excluded.base_epoch",
    [workspaceId, now.getTime()],
  );
  clockCache.set(workspaceId, { base: now.getTime(), setAt: Date.now() });
}

export async function clearGradingClock(workspaceId: string): Promise<void> {
  await db.run("delete from grading_clocks where workspace_id = $1", [workspaceId]);
  clockCache.delete(workspaceId);
}

/** Forget cached clocks at once when a workspace clock is set or cleared. */
export async function invalidateClocks(): Promise<void> {
  cacheFilled = 0;
  clockCache.clear();
}

/**
 * The workspace clock: the real clock, unless a grading clock has been set; then
 * time runs forward in real time from that instant. Decided in this one place.
 */
export async function workspaceNow(workspaceId: string | null): Promise<WallTime> {
  if (workspaceId) {
    try {
      await loadClocks();
    } catch {
      /* fall back to the real clock */
    }
    const entry = clockCache.get(workspaceId);
    if (entry) {
      const epochMs = entry.base + (Date.now() - entry.setAt);
      return { now: new Date(epochMs), epochMs };
    }
  }
  const epochMs = Date.now();
  return { now: new Date(epochMs), epochMs };
}

interface ZonedParts {
  y: number;
  mo: number;
  d: number;
  h: number;
  mi: number;
  s: number;
}

const zonedFormatterCache = new Map<string, Intl.DateTimeFormat>();

function zonedFormatter(zone: string): Intl.DateTimeFormat {
  let f = zonedFormatterCache.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
    zonedFormatterCache.set(zone, f);
  }
  return f;
}

function zonedParts(instant: number, zone: string): ZonedParts {
  const parts = zonedFormatter(zone).formatToParts(new Date(instant));
  const get = (type: Intl.DateTimeFormatPartTypes): number =>
    Number.parseInt(parts.find((p) => p.type === type)?.value ?? "0", 10);
  return { y: get("year"), mo: get("month"), d: get("day"), h: get("hour"), mi: get("minute"), s: get("second") };
}

/** Zone offset east of UTC, in ms, at the given instant. */
export function zoneOffsetMs(instant: number, zone: string): number {
  const p = zonedParts(instant, zone);
  const wallAsUtc = Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s);
  return wallAsUtc - instant;
}

/** Studio-zone calendar-day key, e.g. 2026-11-08. */
export function studioDateKey(instant: number, zone: string): string {
  const p = zonedParts(instant, zone);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${p.y}-${pad(p.mo)}-${pad(p.d)}`;
}

/** Whole calendar days between two studio-zone date keys. */
export function daysBetweenKeys(fromKey: string, toKey: string): number {
  return Math.round((Date.parse(`${toKey}T00:00:00Z`) - Date.parse(`${fromKey}T00:00:00Z`)) / 86_400_000);
}

export function trialDaysLeft(confirmationKey: string, epochMs: number, zone: string): number {
  return Math.max(0, config.limits.TRIAL_DAYS - daysBetweenKeys(confirmationKey, studioDateKey(epochMs, zone)));
}

export function trialEnded(confirmationKey: string, epochMs: number, zone: string): boolean {
  return trialDaysLeft(confirmationKey, epochMs, zone) === 0;
}

/** The instant 23:59:59.999 on the given date in the zone; the link expires at that second. */
export function endOfDayEpochMs(dateKey: string, zone: string): number {
  const wall = Date.parse(`${dateKey}T23:59:59Z`);
  let instant = wall;
  for (let i = 0; i < 2; i++) {
    const offset = zoneOffsetMs(instant, zone);
    instant = wall - offset;
  }
  return instant + 999;
}

/** True when dateKey is today or later in the zone, at the given instant. */
export function dateNotBeforeToday(dateKey: string, epochMs: number, zone: string): boolean {
  return dateKey >= studioDateKey(epochMs, zone);
}
