import type { Sql } from "../db.js";
import { formatCoopTime, formatMonthName } from "../../shared/time.js";
import { num, effectiveState, type LicenceRow } from "./licensing.js";

// Organisation-scoped usage: a licensing manager's totals, expiries table and
// CSV export cover only their own newsroom, and agree with the licence
// listing and shortlist count at every server-clock instant.

export interface UsageLicence {
  id: string;
  essay_id: string;
  essay_title: string;
  essay_caption: string;
  credit_line: string;
  kind: string;
  state: LicenceRow["state"] | "removed";
  confirmed_epoch_ms: number;
  window_start: number;
  window_end: number;
  amount_minor: number;
  invoice_state: string;
  newsroom_slug: string;
}

export async function newsroomLicences(sql: Sql, newsroomId: number, nowMs: number): Promise<UsageLicence[]> {
  const rows = await sql`
    SELECT l.id, l.essay_id, l.kind, l.state, l.confirmed_epoch_ms, l.window_start, l.window_end,
           l.amount_minor, l.invoice_state, e.title AS essay_title, e.caption AS essay_caption, e.taken_down_at IS NOT NULL AS taken_down,
           n.slug AS newsroom_slug
    FROM licences l
    JOIN essays e ON e.id = l.essay_id
    JOIN newsrooms n ON n.id = l.newsroom_id
    WHERE l.newsroom_id = ${newsroomId}
    ORDER BY l.confirmed_epoch_ms DESC, l.id ASC`;
  const licences: UsageLicence[] = [];
  const creditCache = new Map<string, string>();
  for (const row of rows) {
    let state = row.state as LicenceRow["state"];
    if (state === "pending_invoice" && nowMs >= num(row.hold_until)) continue; // removed at its hold deadline
    if (state === "active" && nowMs >= num(row.window_end)) state = "expired";
    if (row.taken_down) state = "revoked";
    let creditLine = creditCache.get(row.essay_id);
    if (creditLine === undefined) {
      const names = await sql`
        SELECT p.name FROM credits c JOIN people p ON p.id = c.person_id
        WHERE c.essay_id = ${row.essay_id} ORDER BY c.position`;
      const list = names.map((n) => n.name);
      creditLine = list.length === 1
        ? `Photographs by ${list[0]}`
        : `Photographs by ${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;
      creditCache.set(row.essay_id, creditLine);
    }
    licences.push({
      id: row.id,
      essay_id: row.essay_id,
      essay_title: row.taken_down ? "Removed essay (legal takedown)" : row.essay_title,
      essay_caption: row.taken_down ? "" : row.essay_caption,
      credit_line: row.taken_down ? "" : creditLine,
      kind: row.kind,
      state,
      confirmed_epoch_ms: num(row.confirmed_epoch_ms),
      window_start: num(row.window_start),
      window_end: num(row.window_end),
      amount_minor: Number(row.amount_minor),
      invoice_state: row.invoice_state,
      newsroom_slug: row.newsroom_slug,
    });
  }
  return licences;
}

export interface UsageTotals {
  newsroom: { slug: string; name: string };
  active: number;
  pending_invoice: number;
  expired: number;
  revoked: number;
  exclusive: number;
  standard: number;
  invoiced_minor: number;
  shortlist_count: number;
  next_expiry: { licence_id: string; window_end: string; window_end_display: string } | null;
}

export function usageTotals(licences: UsageLicence[], nowMs: number): Omit<UsageTotals, "newsroom" | "shortlist_count"> {
  let active = 0;
  let pending = 0;
  let expired = 0;
  let revoked = 0;
  let exclusive = 0;
  let standard = 0;
  let invoiced = 0;
  let nextExpiry: UsageLicence | null = null;
  for (const lic of licences) {
    if (lic.state === "active") active += 1;
    if (lic.state === "pending_invoice") pending += 1;
    if (lic.state === "expired") expired += 1;
    if (lic.state === "revoked") revoked += 1;
    if (lic.state === "pending_invoice" || lic.state === "active") {
      if (lic.kind === "exclusive") exclusive += 1;
      else standard += 1;
    }
    if (lic.invoice_state === "raised") invoiced += lic.amount_minor;
    if (lic.state === "active" && lic.window_end > nowMs) {
      if (!nextExpiry || lic.window_end < nextExpiry.window_end
        || (lic.window_end === nextExpiry.window_end && (lic.confirmed_epoch_ms < nextExpiry.confirmed_epoch_ms
          || (lic.confirmed_epoch_ms === nextExpiry.confirmed_epoch_ms && lic.id < nextExpiry.id)))) {
        nextExpiry = lic;
      }
    }
  }
  return {
    active,
    pending_invoice: pending,
    expired,
    revoked,
    exclusive,
    standard,
    invoiced_minor: invoiced,
    next_expiry: nextExpiry
      ? { licence_id: nextExpiry.id, window_end: toIso(nextExpiry.window_end), window_end_display: formatCoopTime(nextExpiry.window_end) }
      : null,
  };
}

function toIso(ms: number): string {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
}

// The CSV export lists the newsroom's licences in the published columns, with
// times in co-op time, RFC 4180 quoting and neutralised formula cells.
export function usageCsv(licences: UsageLicence[], coopDate: string): string {
  const header = "licence_id,essay_title,caption,credit_line,kind,state,confirmed_at,window_start,window_end,amount,currency";
  const lines = [header];
  for (const lic of licences) {
    const cells = [
      lic.id,
      lic.essay_title,
      lic.essay_caption,
      lic.credit_line,
      lic.kind,
      lic.state,
      csvTime(lic.confirmed_epoch_ms),
      csvTime(lic.window_start),
      csvTime(lic.window_end),
      (lic.amount_minor / 100).toFixed(2),
      "USD",
    ];
    lines.push(cells.map(csvCellSafe).join(","));
  }
  void coopDate;
  return lines.join("\r\n") + "\r\n";
}

function csvTime(ms: number): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZoneName: "shortOffset",
  }).formatToParts(new Date(ms));
  const get = (t: string): string => parts.find((p) => p.type === t)?.value ?? "";
  const offset = parts.find((p) => p.type === "timeZoneName")?.value ?? "GMT-6";
  const abbrev = offset === "GMT-5" ? "CDT" : "CST";
  const hour = get("hour") === "24" ? "00" : get("hour");
  return `${get("year")}-${get("month")}-${get("day")} ${hour}:${get("minute")} ${abbrev}`;
}

function csvCellSafe(value: string): string {
  let cell = value;
  const first = cell.charAt(0);
  if (first === "=" || first === "+" || first === "-" || first === "@" || first === "\t" || first === "\r") {
    cell = `'${cell}`;
  }
  if (/[",\r\n]/.test(cell)) cell = `"${cell.replace(/"/g, '""')}"`;
  return cell;
}

export function statementMonthLabel(month: string): string {
  return formatMonthName(month);
}

export { effectiveState };
