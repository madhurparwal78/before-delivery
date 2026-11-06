import { now, nowMs } from "../clock";
import { pool, q, one, tx } from "../db";
import { lockName } from "../lockname";
import { ApiError, conflict, validation, fieldMsg } from "../errors";
import type { Ctx, Studio } from "../http/context";
import { sendJson } from "../http/context";
import { today, dayStart, addDays, monthOfDate, monthName, isValidMonth } from "../studiodays";
import { publish } from "../events";
import { dollarsPlain } from "../money";
import { checkMonth, checkDay } from "./validate";

// Studio-scoped owner reports, all cut at studio-day boundaries.

export async function getDashboard(ctx: Ctx): Promise<void> {
  const studio = ctx.studio as Studio;
  const todayStr = today(studio.time_zone, nowMs());
  const counts: Record<string, number> = {};
  for (const status of ["logged", "waiting_bisque", "bisqued", "waiting_glaze", "ready_for_pickup"]) {
    const row = await one<{ n: string }>(
      pool,
      `SELECT COUNT(*) AS n FROM pieces p WHERE p.studio_id = $1 AND p.status = $2 AND NOT (p.status = 'logged' AND NOT (SELECT active FROM people WHERE id = p.owner_id))`,
      [studio.id, status],
    );
    counts[status] = Number(row?.n ?? 0);
  }
  const longest = await q<{ id: string; title: string; owner_handle: string; status: string; waiting_since: Date | null }>(
    pool,
    `SELECT p.id, p.title, o.handle AS owner_handle, p.status, p.waiting_since
       FROM pieces p JOIN people o ON o.id = p.owner_id
      WHERE p.studio_id = $1 AND p.status IN ('waiting_bisque','waiting_glaze')
      ORDER BY p.waiting_since ASC LIMIT 10`,
    [studio.id],
  );
  const pending = await one<{ n: string }>(pool, "SELECT COUNT(*) AS n FROM charges WHERE studio_id = $1 AND status = 'pending'", [studio.id]);
  const month = monthOfDate(todayStr);
  const revenue = await revenueForMonth(studio, month);
  sendJson(ctx.res, 200, {
    today: todayStr,
    counts: {
      logged: counts.logged,
      waiting_bisque: counts.waiting_bisque,
      bisqued: counts.bisqued,
      waiting_glaze: counts.waiting_glaze,
      ready_for_pickup: counts.ready_for_pickup,
    },
    longest_waiting: longest.map((r) => ({
      id: r.id,
      title: r.title,
      owner_handle: r.owner_handle,
      status: r.status,
      days_waiting: r.waiting_since ? daysBetween(r.waiting_since, todayStr) : 0,
    })),
    pending_charges: Number(pending?.n ?? 0),
    month_revenue_cents: revenue.net_cents,
  });
}

function daysBetween(from: Date, toDate: string): number {
  const fromStr = from.toISOString().slice(0, 10);
  const [fy, fm, fd] = fromStr.split("-").map(Number);
  const [ty, tm, td] = toDate.split("-").map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86400000);
}

// Revenue for a studio-local month. For a closed month the stored figures are returned.
async function revenueForMonth(studio: Studio, month: string): Promise<{ month: string; closed_at: Date | null; fees_cents: number; refunds_cents: number; net_cents: number; charge_count: number }> {
  const closed = await one<{ fees_cents: number; refunds_cents: number; net_cents: number; charge_count: number; closed_at: Date }>(
    pool,
    "SELECT * FROM month_closes WHERE studio_id = $1 AND month = $2",
    [studio.id, month],
  );
  if (closed) {
    return { month, closed_at: closed.closed_at, fees_cents: closed.fees_cents, refunds_cents: closed.refunds_cents, net_cents: closed.net_cents, charge_count: closed.charge_count };
  }
  return computeRevenue(studio, month);
}

export async function computeRevenue(studio: Studio, month: string): Promise<{ month: string; closed_at: null; fees_cents: number; refunds_cents: number; net_cents: number; charge_count: number }> {
  // Fees count only once settled; refunds count when they became refunded.
  const fees = await q<{ fee_cents: number; settled_at: Date; firing: string; storage_day: string | null }>(
    pool,
    "SELECT fee_cents, settled_at, firing, storage_day FROM charges WHERE studio_id = $1 AND status IN ('settled','refunded') AND settled_at IS NOT NULL",
    [studio.id],
  );
  const refunds = await q<{ fee_cents: number; refunded_at: Date }>(
    pool,
    "SELECT fee_cents, refunded_at FROM charges WHERE studio_id = $1 AND status = 'refunded' AND refunded_at IS NOT NULL",
    [studio.id],
  );
  let feesCents = 0;
  let count = 0;
  for (const f of fees) {
    if (monthOfDate(dateOf(f.settled_at, studio.time_zone)) === month) {
      feesCents += f.fee_cents;
      count += 1;
    }
  }
  let refundsCents = 0;
  for (const r of refunds) {
    if (monthOfDate(dateOf(r.refunded_at, studio.time_zone)) === month) {
      refundsCents += r.fee_cents;
    }
  }
  return { month, closed_at: null, fees_cents: feesCents, refunds_cents: refundsCents, net_cents: feesCents - refundsCents, charge_count: count };
}

function dateOf(at: Date, tz: string): string {
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" });
  return fmt.format(at);
}

export async function getRevenue(ctx: Ctx): Promise<void> {
  const studio = ctx.studio as Studio;
  const raw = ctx.query.get("month");
  const month = raw !== null && raw !== "" ? checkMonth(raw) : monthOfDate(today(studio.time_zone, nowMs()));
  sendJson(ctx.res, 200, await revenueForMonth(studio, month));
}

export async function closeMonth(ctx: Ctx): Promise<void> {
  const studio = ctx.studio as Studio;
  const month = ctx.params.month;
  if (!isValidMonth(month)) throw new ApiError(404, "not_found", "Not found.");
  const name = monthName(month);
  // A month can be closed once it has ended: from the first instant of the next
  // month's first studio day.
  const [y, m] = month.split("-").map(Number);
  const nextMonth = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
  const nextStart = dayStart(`${nextMonth}-01`, studio.time_zone);
  if (now().getTime() < nextStart) {
    throw conflict("month_open", `${name} has not ended yet in the studio's time zone.`);
  }
  const existing = await one<{ closed_at: Date }>(pool, "SELECT closed_at FROM month_closes WHERE studio_id = $1 AND month = $2", [studio.id, month]);
  if (existing) throw conflict("month_closed", `${name} is already closed.`);
  // Of simultaneous closes exactly one answers 200.
  const statement = await buildStatement(studio, month);
  const revenue = await computeRevenue(studio, month);
  const inserted = await tx(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [lockName.close(studio.id, month)]);
    const res = await client.query(
      `INSERT INTO month_closes (studio_id, month, closed_at, fees_cents, refunds_cents, net_cents, charge_count, statement)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (studio_id, month) DO NOTHING`,
      [studio.id, month, now(), revenue.fees_cents, revenue.refunds_cents, revenue.net_cents, revenue.charge_count, statement],
    );
    return res.rowCount === 1;
  });
  if (!inserted) throw conflict("month_closed", `${name} is already closed.`);
  await publish(pool, "month", month, studio.id);
  sendJson(ctx.res, 200, { month, closed_at: now(), fees_cents: revenue.fees_cents, refunds_cents: revenue.refunds_cents, net_cents: revenue.net_cents, charge_count: revenue.charge_count });
}

// The statement CSV, exactly as published. Neutralised cells and quoting in one place.
export function csvCell(value: string): string {
  let out = value;
  if (/^[=+\-@\t\r]/.test(out)) out = `'${out}`;
  if (/[",\r\n]/.test(out)) out = `"${out.replace(/"/g, '""')}"`;
  return out;
}

export async function buildStatement(studio: Studio, month: string): Promise<string> {
  const header = "date,entry,charge_id,member_handle,piece_title,firing,cubic_inches,rate_cents,amount";
  const rows: { date: string; line: string }[] = [];
  const fees = await q<{ id: string; fee_cents: number; settled_at: Date; firing: string; storage_day: string | null; cubic_eighths: number | null; rate_cents: number; member_id: string; piece_id: string }>(
    pool,
    `SELECT c.*, p.title AS piece_title, o.handle AS owner_handle
       FROM charges c JOIN pieces p ON p.id = c.piece_id JOIN people o ON o.id = c.member_id
      WHERE c.studio_id = $1 AND c.status IN ('settled','refunded') AND c.settled_at IS NOT NULL`,
    [studio.id],
  );
  const pieces = new Map<string, string>();
  const handles = new Map<string, string>();
  for (const f of fees) {
    if (!pieces.has(f.piece_id)) {
      const p = await one<{ title: string }>(pool, "SELECT title FROM pieces WHERE id = $1", [f.piece_id]);
      pieces.set(f.piece_id, p?.title ?? "");
    }
    if (!handles.has(f.member_id)) {
      const o = await one<{ handle: string }>(pool, "SELECT handle FROM people WHERE id = $1", [f.member_id]);
      handles.set(f.member_id, o?.handle ?? "");
    }
  }
  const refunds = await q<{ id: string; fee_cents: number; refunded_at: Date; firing: string; storage_day: string | null; cubic_eighths: number | null; rate_cents: number; member_id: string; piece_id: string }>(
    pool,
    "SELECT * FROM charges WHERE studio_id = $1 AND status = 'refunded' AND refunded_at IS NOT NULL",
    [studio.id],
  );
  for (const f of fees) {
    if (monthOfDate(dateOf(f.settled_at, studio.time_zone)) !== month) continue;
    const entry = f.storage_day !== null ? "storage" : "fee";
    const cubic = f.cubic_eighths === null ? "" : (f.cubic_eighths / 8).toFixed(3);
    const line = [
      dateOf(f.settled_at, studio.time_zone),
      entry,
      f.id,
      handles.get(f.member_id) ?? "",
      pieces.get(f.piece_id) ?? "",
      f.firing,
      cubic,
      String(f.rate_cents),
      dollarsPlain(f.fee_cents),
    ].map(csvCell).join(",");
    rows.push({ date: dateOf(f.settled_at, studio.time_zone), line });
  }
  for (const r of refunds) {
    if (monthOfDate(dateOf(r.refunded_at, studio.time_zone)) !== month) continue;
    const cubic = r.cubic_eighths === null ? "" : (r.cubic_eighths / 8).toFixed(3);
    const line = [
      dateOf(r.refunded_at, studio.time_zone),
      "refund",
      r.id,
      handles.get(r.member_id) ?? "",
      pieces.get(r.piece_id) ?? "",
      r.firing,
      cubic,
      String(r.rate_cents),
      dollarsPlain(r.fee_cents),
    ].map(csvCell).join(",");
    rows.push({ date: dateOf(r.refunded_at, studio.time_zone), line });
  }
  rows.sort((a, b) => (a.date === b.date ? (a.line < b.line ? -1 : 1) : a.date < b.date ? -1 : 1));
  return [header, ...rows.map((r) => r.line)].join("\r\n") + "\r\n";
}

export async function getStatement(ctx: Ctx): Promise<void> {
  const studio = ctx.studio as Studio;
  const raw = ctx.query.get("month");
  const month = raw !== null && raw !== "" ? checkMonth(raw) : monthOfDate(today(studio.time_zone, nowMs()));
  const closed = await one<{ statement: string }>(pool, "SELECT statement FROM month_closes WHERE studio_id = $1 AND month = $2", [studio.id, month]);
  const csv = closed ? closed.statement : await buildStatement(studio, month);
  const payload = Buffer.from(csv, "utf8");
  ctx.res.writeHead(200, {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Length": payload.length,
    "Content-Disposition": `attachment; filename="statement-${month}.csv"`,
    "Cache-Control": "no-store",
  });
  ctx.res.end(payload);
}

export async function getFiringLog(ctx: Ctx): Promise<void> {
  const studio = ctx.studio as Studio;
  const raw = ctx.query.get("date");
  const day = raw !== null && raw !== "" ? checkDay(raw) : today(studio.time_zone, nowMs());
  const start = dayStart(day, studio.time_zone);
  const end = dayStart(addDays(day, 1), studio.time_zone);
  const loads = await q<{ id: string; kiln_name: string; firing: string; unloaded_at: Date }>(
    pool,
    `SELECT l.id, k.name AS kiln_name, l.firing, l.unloaded_at
       FROM loads l JOIN kilns k ON k.id = l.kiln_id
      WHERE l.studio_id = $1 AND l.status = 'unloaded' AND l.unloaded_at >= $2 AND l.unloaded_at < $3
      ORDER BY l.unloaded_at`,
    [studio.id, new Date(start), new Date(end)],
  );
  const firings = [];
  for (const l of loads) {
    const pieceCount = Number((await one<{ n: string }>(pool, "SELECT COUNT(*) AS n FROM placements WHERE load_id = $1", [l.id]))?.n ?? 0);
    const pieces = await q<{ cubic_eighths: number; bisque_rate_cents: number; glaze_rate_cents: number }>(
      pool,
      `SELECT p.cubic_eighths, p.bisque_rate_cents, p.glaze_rate_cents FROM placements pl JOIN pieces p ON p.id = pl.piece_id WHERE pl.load_id = $1`,
      [l.id],
    );
    const { feeCents } = await import("../quote");
    let value = 0;
    for (const p of pieces) {
      value += feeCents(p.cubic_eighths, l.firing === "bisque" ? p.bisque_rate_cents : p.glaze_rate_cents);
    }
    firings.push({ load_id: l.id, kiln_name: l.kiln_name, firing: l.firing, unloaded_at: l.unloaded_at, piece_count: pieceCount, value_cents: value });
  }
  sendJson(ctx.res, 200, { date: day, time_zone: studio.time_zone, firings });
}

export { validation, fieldMsg };
