// Every hold transition (brief: Holds) is decided here. Callers lock the yacht row first, so the database
// orders every placement, lapse, move-up and release on one yacht.
import { randomUUID } from "node:crypto";
import type pg from "pg";
import { config } from "../config";
import { one, pool, rows, transaction, type Db } from "../db";
import { conflict, type Json } from "../http";
import { isoInstant } from "../../shared/zones";
import { weekEnd } from "./weeks";

export type HoldStatus = "waiting" | "live" | "lapsed" | "released" | "charter";

interface HoldRow {
  id: string;
  workspace_slug: string;
  yacht_id: string;
  yacht_slug: string;
  week_start: string;
  client_name: string;
  placed_by_kind: "member" | "broker";
  placed_by_name: string;
  broker_id: string | null;
  status: HoldStatus;
  line_seq: number;
  placed_at: Date;
  live_since: Date | null;
  lapses_at: Date | null;
  charter_id: string | null;
}

export interface Hold extends HoldRow {
  effective: HoldStatus;
  position: number | null;
}

const SELECT = `SELECT h.*, y.slug AS yacht_slug FROM holds h JOIN yachts y ON y.id = h.yacht_id`;

/** The status the server reports: a live hold is lapsed from its lapse instant on, the instant included. */
function effectiveStatus(row: HoldRow, nowMs: number): HoldStatus {
  return row.status === "live" && row.lapses_at && row.lapses_at.getTime() <= nowMs ? "lapsed" : row.status;
}

/** Adds the reported status and the line position (1 for the first waiting hold of its week). */
async function withPositions(db: Db, holds: HoldRow[], nowMs: number): Promise<Hold[]> {
  const weeks = [...new Set(holds.filter((h) => h.status === "waiting").map((h) => `${h.yacht_id}|${h.week_start}`))];
  const order = new Map<string, number>();
  if (weeks.length) {
    const waiting = await rows<{ id: string; position: number }>(
      db,
      `SELECT id, row_number() OVER (PARTITION BY yacht_id, week_start ORDER BY line_seq)::int AS position
         FROM holds WHERE status = 'waiting' AND (yacht_id::text || '|' || week_start::text) = ANY($1)`,
      [weeks],
    );
    for (const w of waiting) order.set(w.id, w.position);
  }
  return holds.map((h) => ({ ...h, effective: effectiveStatus(h, nowMs), position: h.status === "waiting" ? order.get(h.id) ?? null : null }));
}

export async function holdsWhere(db: Db, where: string, params: unknown[], nowMs: number): Promise<Hold[]> {
  return withPositions(db, await rows<HoldRow>(db, `${SELECT} WHERE ${where} ORDER BY h.placed_at DESC, h.line_seq DESC`, params), nowMs);
}

export async function holdById(db: Db, workspace: string, id: string, nowMs: number, lock = false): Promise<Hold | undefined> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return undefined;
  const row = await one<HoldRow>(db, `${SELECT} WHERE h.id = $1 AND h.workspace_slug = $2${lock ? " FOR UPDATE OF h" : ""}`, [id, workspace]);
  return row ? (await withPositions(db, [row], nowMs))[0] : undefined;
}

const iso = (d: Date | null): string | null => (d ? isoInstant(d.getTime()) : null);

export function holdJson(h: Hold): Json {
  return {
    id: h.id,
    yachtSlug: h.yacht_slug,
    weekStart: h.week_start,
    weekEnd: weekEnd(h.week_start),
    clientName: h.client_name,
    placedBy: { kind: h.placed_by_kind, name: h.placed_by_name },
    status: h.effective,
    position: h.position,
    placedAt: iso(h.placed_at),
    liveSince: iso(h.live_since),
    lapsesAt: iso(h.lapses_at),
    charterId: h.charter_id,
  };
}

export function brokerHoldJson(h: Hold): Json {
  return {
    id: h.id,
    yachtSlug: h.yacht_slug,
    weekStart: h.week_start,
    clientName: h.client_name,
    status: h.effective,
    position: h.position,
    lapsesAt: iso(h.lapses_at),
  };
}

async function moveUpLine(db: pg.PoolClient, yachtId: string, weekStart: string): Promise<void> {
  const live = await one(db, "SELECT 1 FROM holds WHERE yacht_id = $1 AND week_start = $2 AND status = 'live'", [yachtId, weekStart]);
  if (live) return;
  await db.query(
    `UPDATE holds SET status = 'live', live_since = now(), lapses_at = now() + make_interval(secs => $3)
      WHERE id = (SELECT id FROM holds WHERE yacht_id = $1 AND week_start = $2 AND status = 'waiting' ORDER BY line_seq LIMIT 1)`,
    [yachtId, weekStart, config.timers.holdSeconds],
  );
}

/** Lapses the week's live hold once its time is up and moves the line up. The yacht row must be locked. */
async function settleWeek(db: pg.PoolClient, yachtId: string, weekStart: string): Promise<void> {
  const lapsed = await db.query(
    "UPDATE holds SET status = 'lapsed' WHERE yacht_id = $1 AND week_start = $2 AND status = 'live' AND lapses_at <= now()",
    [yachtId, weekStart],
  );
  if (lapsed.rowCount) await moveUpLine(db, yachtId, weekStart);
}

export interface Placement {
  workspace: string;
  yachtId: string;
  weekStart: string;
  clientName: string;
  queue: boolean;
  placedBy: { kind: "member" | "broker"; name: string; brokerId: string | null };
}

/**
 * Whether a week on a locked yacht can be taken: a charter books it, and a live hold takes it unless the request
 * joins the line. Resolves true when a live hold is ahead in the line.
 */
export async function checkWeek(db: pg.PoolClient, yachtId: string, weekStart: string, queue: boolean): Promise<boolean> {
  await settleWeek(db, yachtId, weekStart);
  if (await one(db, "SELECT 1 FROM charters WHERE yacht_id = $1 AND week_start = $2", [yachtId, weekStart])) {
    throw conflict("week_booked");
  }
  const live = await one<{ placed_by_name: string; live_since: Date }>(
    db,
    "SELECT placed_by_name, live_since FROM holds WHERE yacht_id = $1 AND week_start = $2 AND status = 'live'",
    [yachtId, weekStart],
  );
  if (live && !queue) throw conflict("week_taken", { takenBy: live.placed_by_name, takenAt: isoInstant(live.live_since.getTime()) });
  return Boolean(live);
}

/** Places a hold on a locked yacht: live on a free week, waiting in line with queue on, else refused. */
export async function placeHold(db: pg.PoolClient, p: Placement, nowMs: number): Promise<Hold> {
  const live = await checkWeek(db, p.yachtId, p.weekStart, p.queue);
  const id = randomUUID();
  await db.query(
    `INSERT INTO holds (id, workspace_slug, yacht_id, week_start, client_name, placed_by_kind, placed_by_name, broker_id, status,
                        placed_at, live_since, lapses_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, now(),
             CASE WHEN $9 = 'live' THEN now() END,
             CASE WHEN $9 = 'live' THEN now() + make_interval(secs => $10) END)`,
    [id, p.workspace, p.yachtId, p.weekStart, p.clientName, p.placedBy.kind, p.placedBy.name, p.placedBy.brokerId,
      live ? "waiting" : "live", config.timers.holdSeconds],
  );
  return (await holdById(db, p.workspace, id, nowMs))!;
}

/** Releases a live or waiting hold; a lapsed one is too late, anything else is no longer live. */
export async function releaseHold(db: pg.PoolClient, hold: Hold, nowMs: number): Promise<Hold> {
  if (hold.effective === "lapsed") throw conflict("hold_lapsed", { lapsedAt: iso(hold.lapses_at) });
  if (hold.effective !== "live" && hold.effective !== "waiting") throw conflict("hold_not_live", { status: hold.effective });
  await db.query("UPDATE holds SET status = 'released' WHERE id = $1", [hold.id]);
  if (hold.effective === "live") await moveUpLine(db, hold.yacht_id, hold.week_start);
  return (await holdById(db, hold.workspace_slug, hold.id, nowMs))!;
}

/** A deposit may only turn a live hold into a charter. */
export function assertDepositable(hold: Hold): void {
  if (hold.effective === "lapsed") throw conflict("hold_lapsed", { lapsedAt: iso(hold.lapses_at) });
  if (hold.effective !== "live") throw conflict("hold_not_live", { status: hold.effective });
}

export async function markCharter(db: pg.PoolClient, holdId: string, charterId: string): Promise<void> {
  await db.query("UPDATE holds SET status = 'charter', charter_id = $2 WHERE id = $1", [holdId, charterId]);
}

/** The timed sweep: every lapsed live hold is marked lapsed and its line moves up. */
export async function sweepLapses(): Promise<void> {
  const due = await rows<{ yacht_id: string; week_start: string }>(
    pool,
    "SELECT DISTINCT yacht_id, week_start FROM holds WHERE status = 'live' AND lapses_at <= now()",
  );
  for (const week of due) {
    await transaction(async (db) => {
      await db.query("SELECT 1 FROM yachts WHERE id = $1 FOR UPDATE", [week.yacht_id]);
      await settleWeek(db, week.yacht_id, week.week_start);
    });
  }
}

type WeekStatus = "free" | "held" | "booked";

interface WeekState {
  status: WeekStatus;
  liveHoldId: string | null;
  waitingCount: number;
}

/** Each week's status: booked with a charter, held with a live or waiting hold, free otherwise. */
export async function weekStates(db: Db, yachtId: string, weekStarts: string[], nowMs: number): Promise<Map<string, WeekState>> {
  const booked = new Set(
    (await rows<{ week_start: string }>(db, "SELECT week_start FROM charters WHERE yacht_id = $1 AND week_start = ANY($2::date[])", [yachtId, weekStarts]))
      .map((r) => r.week_start),
  );
  const active = await rows<HoldRow>(
    db,
    `${SELECT} WHERE h.yacht_id = $1 AND h.week_start = ANY($2::date[]) AND h.status IN ('live', 'waiting')`,
    [yachtId, weekStarts],
  );
  const out = new Map<string, WeekState>();
  for (const week of weekStarts) {
    const here = active.filter((h) => h.week_start === week);
    const live = here.find((h) => effectiveStatus(h, nowMs) === "live");
    const waiting = here.filter((h) => h.status === "waiting").length;
    out.set(week, {
      status: booked.has(week) ? "booked" : live || waiting ? "held" : "free",
      liveHoldId: live?.id ?? null,
      waitingCount: waiting,
    });
  }
  return out;
}
