import type { Sql } from "../db.js";
import { errors, ApiError } from "../errors.js";
import { windowEnd, holdDeadline, isoInstant, formatCoopTime, rateEffectiveFromAt, coopDateOf } from "../../shared/time.js";
import type { PersonRow } from "./essays.js";

// Licensing: one winner per window, effective ends judged from the server
// clock on every read, activation all-or-nothing, and database-level guards
// allowing only one pending or active exclusive per essay and one pending or
// active licence per newsroom per essay.

export type LicenceKind = "exclusive" | "standard";
export type LicenceState = "pending_invoice" | "active" | "expired" | "revoked";
// A pending licence reads as removed once its hold deadline arrives.
export type EffectiveState = LicenceState | "removed";

export interface LicenceRow {
  id: string;
  essay_id: string;
  newsroom_id: number;
  licensed_by: number;
  kind: LicenceKind;
  state: LicenceState;
  confirmed_at: Date;
  confirmed_epoch_ms: bigint;
  window_start: bigint;
  window_end: bigint;
  hold_until: bigint;
  amount_minor: number;
  rate_bp: number;
  invoice_state: "pending" | "raised";
  receipt_state: "queued" | "sent" | "cancelled" | null;
  essay_title: string;
  essay_caption: string;
  credit_line: string;
  lift_at: Date;
  newsroom_slug: string;
  newsroom_name: string;
  licensed_by_name: string;
  essay_state: string;
  essay_taken_down: boolean;
}

// An essay advisory lock serialises licence requests, activations and
// takedowns with each other (DP-69), across instances sharing the database.
export function essayLockKey(essayId: string): string {
  let hash = 0;
  for (let i = 0; i < essayId.length; i++) {
    hash = (hash * 31 + essayId.charCodeAt(i)) >>> 0;
  }
  return `9223372036854775${hash}`.slice(0, 19);
}

export const num = (v: unknown): number => Number(v);

export function effectiveState(licence: LicenceRow, nowMs: number): EffectiveState {
  if (licence.state === "pending_invoice") {
    // A pending licence is removed at its hold deadline; reads never show it
    // from that instant even before the sweep collects it.
    if (nowMs >= num(licence.hold_until)) return "removed";
    return "pending_invoice";
  }
  if (licence.state === "active" && nowMs >= num(licence.window_end)) return "expired";
  return licence.state;
}

export async function loadLicence(sql: Sql, id: string): Promise<LicenceRow | null> {
  const rows = await sql`
    SELECT l.*, e.title AS essay_title, e.caption AS essay_caption, e.state AS essay_state,
           e.lift_at, e.taken_down_at IS NOT NULL AS essay_taken_down, e.id AS essay_id,
           n.slug AS newsroom_slug, n.name AS newsroom_name, p.name AS licensed_by_name
    FROM licences l
    JOIN essays e ON e.id = l.essay_id
    JOIN newsrooms n ON n.id = l.newsroom_id
    JOIN people p ON p.id = l.licensed_by
    WHERE l.id = ${id}`;
  const row = rows[0] as (LicenceRow & { essay_taken_down: boolean }) | undefined;
  if (!row) return null;
  // Credit line is computed from credits in credit order.
  const names = await sql`
    SELECT p.name FROM credits c JOIN people p ON p.id = c.person_id
    WHERE c.essay_id = ${row.essay_id} ORDER BY c.position`;
  row.credit_line = `Photographs by ${names.map((n2) => n2.name).join(", ").replace(/, ([^,]*)$/, " and $1")}`;
  return row;
}

export interface WindowInfo {
  state: "open" | "claimed";
  held_by: "you" | "your_newsroom" | "another_newsroom" | null;
  held_until: string | null;
  held_until_display: string | null;
  standard_running_until: string | null;
  standard_running_until_display: string | null;
}

// The window, judged at nowMs: claimed while an exclusive is pending within
// its hold or active; standard_running_until is the latest effective end among
// other newsrooms' pending or active standard licences.
export interface WindowRow {
  kind: LicenceKind;
  state: LicenceState;
  newsroom_id: number;
  hold_until: bigint | number;
  window_end: bigint | number;
}

export async function windowInfo(sql: Sql, essayId: string, viewerNewsroomId: number | null, nowMs: number): Promise<WindowInfo> {
  const licences = await sql`
    SELECT kind, state, newsroom_id, hold_until, window_end FROM licences
    WHERE essay_id = ${essayId} AND state IN ('pending_invoice','active')`;
  const rows = licences as unknown as WindowRow[];
  let exclusive: WindowRow | null = null;
  let exclusiveEnd = 0;
  let standardEnd = 0;
  for (const lic of rows) {
    const end = num(lic.state === "pending_invoice" ? lic.hold_until : lic.window_end);
    if (lic.state === "pending_invoice" && nowMs >= num(lic.hold_until)) continue;
    if (lic.state === "active" && nowMs >= num(lic.window_end)) continue;
    if (lic.kind === "exclusive") {
      if (!exclusive || end > exclusiveEnd) {
        exclusive = lic;
        exclusiveEnd = end;
      }
    } else {
      if (end > standardEnd) standardEnd = end;
    }
  }
  const info: WindowInfo = {
    state: exclusive ? "claimed" : "open",
    held_by: null,
    held_until: null,
    held_until_display: null,
    standard_running_until: null,
    standard_running_until_display: null,
  };
  if (exclusive) {
    info.held_until = isoInstant(exclusiveEnd);
    info.held_until_display = formatCoopTime(exclusiveEnd);
    if (viewerNewsroomId !== null && Number(exclusive.newsroom_id) === viewerNewsroomId) info.held_by = "your_newsroom";
    else info.held_by = "another_newsroom";
  }
  if (standardEnd > 0) {
    info.standard_running_until = isoInstant(standardEnd);
    info.standard_running_until_display = formatCoopTime(standardEnd);
  }
  return info;
}

// Effective end of a licence: its hold deadline while pending, its window end
// once active.
export function effectiveEnd(licence: { state: string; hold_until: bigint | number; window_end: bigint | number }): number {
  return licence.state === "pending_invoice" ? num(licence.hold_until) : num(licence.window_end);
}

export function newLicenceId(): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  let id = "";
  for (let i = 0; i < 12; i++) id += alphabet[Math.floor(Math.random() * alphabet.length)];
  return `lic-${id}`;
}

export async function rateAtConfirmation(sql: Sql, confirmedAtMs: number): Promise<number> {
  const rates = await sql`SELECT effective_from::text AS effective_from, rate_bp FROM commission_rates`;
  const best = rateEffectiveFromAt(
    rates.map((r) => ({ effective_from: String(r.effective_from), rate_bp: Number(r.rate_bp) })),
    confirmedAtMs,
  );
  return best?.rate_bp ?? 0;
}

export interface CreateResult {
  status: number; // 201 active, 202 pending
  body: unknown;
}

export interface WindowCheck {
  ok: boolean;
  error?: ApiError;
}

// Pre-insert checks for a licence request, run under the essay advisory lock.
// The one-per-newsroom check comes after the held-window checks.
export async function checkLicensable(
  sql: Sql,
  essayId: string,
  kind: LicenceKind,
  person: PersonRow,
  nowMs: number,
): Promise<WindowCheck> {
  const essayRows = await sql`SELECT state, lift_at, title FROM essays WHERE id = ${essayId}`;
  const essay = essayRows[0];
  if (!essay) return { ok: false, error: errors.notFound() };
  if (essay.state === "taken_down") return { ok: false, error: errors.takenDown() };
  if (essay.state !== "embargoed" && essay.state !== "live") return { ok: false, error: errors.notLicensable() };

  const licences = await sql`
    SELECT kind, state, newsroom_id, hold_until, window_end FROM licences
    WHERE essay_id = ${essayId} AND state IN ('pending_invoice','active')`;
  const rows = licences as unknown as WindowRow[];
  const others = rows.filter((l) => Number(l.newsroom_id) !== person.newsroom_id);
  const mine = rows.filter((l) => Number(l.newsroom_id) === person.newsroom_id);

  if (kind === "exclusive") {
    // An exclusive claim is refused while any other newsroom has a pending or
    // active standard licence.
    const runningStandard = others.find((l) => {
      if (l.kind !== "standard") return false;
      if (l.state === "pending_invoice") return nowMs < num(l.hold_until);
      return nowMs < num(l.window_end);
    });
    if (runningStandard) {
      const end = effectiveEnd(runningStandard);
      return {
        ok: false,
        error: errors.standardLicencesActive(isoInstant(end), formatCoopTime(end)),
      };
    }
  } else {
    // A standard licence is refused while another newsroom holds the exclusive.
    const rivalExclusive = others.find((l) => {
      if (l.kind !== "exclusive") return false;
      if (l.state === "pending_invoice") return nowMs < num(l.hold_until);
      return nowMs < num(l.window_end);
    });
    if (rivalExclusive) {
      const end = effectiveEnd(rivalExclusive);
      return {
        ok: false,
        error: errors.exclusiveHeld("another_newsroom", isoInstant(end), formatCoopTime(end)),
      };
    }
  }

  const onePerNewsroom = mine.find((l) =>
    l.state === "pending_invoice" ? nowMs < num(l.hold_until) : nowMs < num(l.window_end));
  if (onePerNewsroom) return { ok: false, error: errors.alreadyLicensed() };

  return { ok: true };
}

// The exclusive-window conflict when the insert trips the partial unique
// index: every other claimant gets window_held with the holder's effective end.
export async function windowHeldError(sql: Sql, essayId: string, viewerNewsroomId: number | null, nowMs: number): Promise<ApiError> {
  const licences = await sql`
    SELECT kind, state, newsroom_id, hold_until, window_end FROM licences
    WHERE essay_id = ${essayId} AND kind = 'exclusive' AND state IN ('pending_invoice','active')`;
  const rows = licences as unknown as WindowRow[];
  let holder: WindowRow | null = null;
  let holderEnd = 0;
  for (const lic of rows) {
    const end = effectiveEnd(lic);
    if ((lic.state === "pending_invoice" || lic.state === "active") && end > nowMs) {
      if (!holder || end > holderEnd) {
        holder = lic;
        holderEnd = end;
      }
    }
  }
  if (!holder) return errors.notLicensable();
  const heldBy: "you" | "your_newsroom" | "another_newsroom" =
    viewerNewsroomId !== null && Number(holder.newsroom_id) === viewerNewsroomId ? "your_newsroom" : "another_newsroom";
  return errors.windowHeld(heldBy, isoInstant(holderEnd), formatCoopTime(holderEnd));
}

export function licenceWindow(
  kind: LicenceKind,
  confirmedMs: number,
  liftAtMs: number,
  days: number,
): { windowStart: number; windowEnd: number; holdUntil: number } {
  const end = windowEnd(confirmedMs, liftAtMs, days);
  return { windowStart: confirmedMs, windowEnd: end, holdUntil: holdDeadline(confirmedMs, end) };
}

export function isIdempotencyKeyValid(key: string): boolean {
  if (key.length < 1 || key.length > 100) return false;
  return /^[\x21-\x7e]+$/.test(key);
}

export function confirmedDateStr(licence: LicenceRow): string {
  return coopDateOf(num(licence.confirmed_epoch_ms));
}
