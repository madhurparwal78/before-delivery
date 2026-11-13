import { query } from "./db.js";
import { CrewRecord } from "./crew-record.js";
import { judgeWindow, restHoursIn, restPeriodsFromCells } from "./rest-rules.js";
import { HALF_HOUR_MS, HOUR_MS, fromUtcString, toShipDate, toShipTimeString, toUtcString } from "../shared/time.js";

/** A strip cell as the API returns it. */
export interface StripCell {
  start_utc: string;
  ship_date: string;
  ship_time: string;
  state: "not_logged" | "rest" | "work" | "short_break" | "late";
  late: boolean;
}

export interface StripWindow {
  step: number;
  start_utc: string;
  end_utc: string;
  rest_hours: number;
  verdict: "pass" | "breach" | "incomplete";
  rules_failed: string[];
  rule_set: "standard" | "flag_exception";
}

export interface StripResponse {
  start_utc: string;
  end_utc: string;
  cells: StripCell[];
  clock_changes: unknown[];
  fixes: unknown[];
  windows: { "24": StripWindow[]; "168": StripWindow[] };
}

/** The 336-hour strip: 672 half-hour cells and every window per width. */
export async function buildStrip(record: CrewRecord, startMs: number): Promise<StripResponse> {
  const endMs = startMs + 336 * HOUR_MS;
  // Cells run an hour either side of the strip so windows judge runs whole.
  const cells = await record.cellSampleRange(startMs - HOUR_MS, endMs + HOUR_MS);
  const stripCells = cells.filter((c) => c.startMs >= startMs && c.startMs < endMs);
  const outCells: StripCell[] = stripCells.map((c) => {
    const state = c.state === "rest" ? "rest" : c.state === "work" ? "work" : "not_logged";
    return {
      start_utc: toUtcString(c.startMs),
      ship_date: record.timeline.shipDateOf(c.startMs),
      ship_time: toShipTimeString(c.startMs, record.timeline.offsetAt(c.startMs)).slice(11),
      state,
      late: false,
    };
  });
  markStripShortBreaks(outCells);

  const windows: StripResponse["windows"] = { "24": [], "168": [] };
  for (const width of [24, 168] as const) {
    // Steps run 0 to (336 - width) * 2: 625 windows for 24 hours, 337 for 168.
    const stepMax = (336 - width) * 2;
    for (let step = 0; step <= stepMax; step++) {
      const windowStart = startMs + step * HALF_HOUR_MS;
      const windowEnd = windowStart + width * HOUR_MS;
      const ruleSet = record.ruleSetAt(windowEnd);
      const judgement = judgeWindow(cells, windowStart, width, ruleSet);
      const hasUnlogged = cells.some((c) => c.startMs >= windowStart && c.startMs < windowEnd && c.state === "not_logged");
      windows[width === 24 ? "24" : "168"].push({
        step,
        start_utc: toUtcString(windowStart),
        end_utc: toUtcString(windowEnd),
        rest_hours: judgement.restHours,
        verdict: hasUnlogged ? "incomplete" : judgement.failedRules.length > 0 ? "breach" : "pass",
        rules_failed: hasUnlogged ? [] : judgement.failedRules,
        rule_set: ruleSet,
      });
    }
  }

  return {
    start_utc: toUtcString(startMs),
    end_utc: toUtcString(endMs),
    cells: outCells,
    clock_changes: [],
    fixes: [],
    windows,
  };
}

function markStripShortBreaks(cells: StripCell[]): void {
  const n = cells.length;
  const isRest = (i: number) => cells[i]!.state === "rest";
  for (let i = 0; i < n; i++) {
    if (!isRest(i)) continue;
    let start = i;
    while (start > 0 && isRest(start - 1)) start--;
    let end = i;
    while (end < n - 1 && isRest(end + 1)) end++;
    if (end - start + 1 < 2) cells[i]!.state = "short_break";
  }
}

/** The single window endpoint. */
export async function buildWindow(record: CrewRecord, startMs: number, hours: 24 | 168): Promise<unknown> {
  const endMs = startMs + hours * HOUR_MS;
  const ruleSet = record.ruleSetAt(endMs);
  // Fetch with margin so runs crossing the window's edges keep their true length.
  const cells = await record.cellSampleRange(startMs - HOUR_MS, endMs + HOUR_MS);
  const judgement = judgeWindow(cells, startMs, hours, ruleSet);
  const windowCells = cells.filter((c) => c.startMs >= startMs && c.startMs < endMs);
  const hasUnlogged = windowCells.some((c) => c.state === "not_logged");
  const changes = record.timeline.changesBetween(startMs, endMs);
  let foldState = "flat";
  let hasGap = false;
  let hasCrease = false;
  const labels: string[] = [];
  for (const change of changes) {
    if (change.new_offset_minutes < change.old_offset_minutes) {
      hasGap = true;
      labels.push(`+${Math.abs(change.old_offset_minutes - change.new_offset_minutes) / 60} h`);
    } else {
      hasCrease = true;
      labels.push(`-${Math.abs(change.old_offset_minutes - change.new_offset_minutes) / 60} h`);
    }
  }
  if (hasGap && hasCrease) foldState = "gap_and_crease";
  else if (hasGap) foldState = "gap";
  else if (hasCrease) foldState = "crease";
  const startOffset = record.timeline.offsetAt(startMs);
  const endOffset = record.timeline.offsetJustBefore(endMs);
  const position = await positionAt(record.vesselId, endMs);
  return {
    start_utc: toUtcString(startMs),
    end_utc: toUtcString(endMs),
    hours,
    start_ship_time: toShipTimeString(startMs, startOffset),
    end_ship_time: toShipTimeString(endMs, endOffset),
    rest_hours: judgement.restHours,
    verdict: hasUnlogged ? "incomplete" : judgement.failedRules.length > 0 ? "breach" : "pass",
    rules_failed: hasUnlogged ? [] : judgement.failedRules,
    rule_set: ruleSet,
    longitude: position?.longitude ?? null,
    latitude: position?.latitude ?? null,
    fold_state: foldState,
    clock_face_hours: hours + (endOffset - startOffset) / 60,
    clock_change_labels: labels,
  };
}

/** Great-circle position interpolation between the fixes either side of an instant. */
export async function positionAt(vesselId: string, atMs: number): Promise<{ latitude: number; longitude: number } | null> {
  const rows = await query<{ at_utc: string; latitude: number; longitude: number }>(
    `SELECT at_utc, latitude, longitude FROM fixes WHERE vessel_id = $1 ORDER BY at_utc`, [vesselId]);
  if (rows.length === 0) return null;
  const fixes = rows.map((r) => ({ atMs: fromUtcString(r.at_utc)!, latitude: r.latitude, longitude: r.longitude }));
  if (atMs <= fixes[0]!.atMs) return { latitude: fixes[0]!.latitude, longitude: fixes[0]!.longitude };
  const last = fixes[fixes.length - 1]!;
  if (atMs >= last.atMs) return { latitude: last.latitude, longitude: last.longitude };
  for (let i = 0; i < fixes.length - 1; i++) {
    const a = fixes[i]!;
    const b = fixes[i + 1]!;
    if (atMs >= a.atMs && atMs <= b.atMs) {
      const share = (atMs - a.atMs) / (b.atMs - a.atMs);
      return greatCircle(a, b, share);
    }
  }
  return { latitude: last.latitude, longitude: last.longitude };
}

function greatCircle(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
  share: number
): { latitude: number; longitude: number } {
  const toRad = Math.PI / 180;
  const lat1 = a.latitude * toRad;
  const lat2 = b.latitude * toRad;
  const lon1 = a.longitude * toRad;
  const lon2 = b.longitude * toRad;
  const d = 2 * Math.asin(Math.sqrt(
    Math.sin((lat2 - lat1) / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin((lon2 - lon1) / 2) ** 2));
  if (d === 0) return { latitude: a.latitude, longitude: a.longitude };
  const A = Math.sin((1 - share) * d) / Math.sin(d);
  const B = Math.sin(share * d) / Math.sin(d);
  const x = A * Math.cos(lat1) * Math.cos(lon1) + B * Math.cos(lat2) * Math.cos(lon2);
  const y = A * Math.cos(lat1) * Math.sin(lon1) + B * Math.cos(lat2) * Math.sin(lon2);
  const z = A * Math.sin(lat1) + B * Math.sin(lat2);
  const lat = Math.atan2(z, Math.sqrt(x * x + y * y)) / toRad;
  const lon = Math.atan2(y, x) / toRad;
  return { latitude: round2(lat), longitude: normalizeLongitude(lon) };
}

function normalizeLongitude(lon: number): number {
  let l = lon;
  while (l > 180) l -= 360;
  while (l < -180) l += 360;
  return round2(l);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
