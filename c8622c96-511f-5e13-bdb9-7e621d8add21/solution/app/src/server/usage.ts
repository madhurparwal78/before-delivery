// Usage for licensing managers: totals and the CSV export come from the same newsroom-scoped read.
import { coopCsvTime, coopDateOf, coopTime, isoInstant } from "../shared/coop-time.js";
import { centsToDecimal } from "../shared/money.js";
import { newsroomOf, requireRole } from "./auth.js";
import { serverNow } from "./clock.js";
import { shortlistOf } from "./follows.js";
import { holdsWindow } from "./licence-state.js";
import { essayCaptions, licenceBodies, newsroomLicences, type Listed } from "./licences.js";
import { on, type Ctx } from "./router.js";
import { sendJson } from "./http.js";

/** Active licences (their end is still ahead), earliest end first, then earlier confirmation, then id. */
function expiryOrder(listed: Listed[]): Listed[] {
  return listed.filter((l) => l.state === "active").sort((a, b) =>
    a.row.window_end.getTime() - b.row.window_end.getTime()
    || a.row.confirmed_at.getTime() - b.row.confirmed_at.getTime()
    || (a.row.id < b.row.id ? -1 : 1));
}

on("GET", "/api/usage", "none", async (ctx: Ctx) => {
  requireRole(ctx.person, "licensing_manager");
  const room = newsroomOf(ctx.person);
  const now = await serverNow();
  const [listed, shortlist] = await Promise.all([newsroomLicences(room.slug, now), shortlistOf(room.slug)]);
  const count = (test: (l: Listed) => boolean): number => listed.filter(test).length;
  const expiries = expiryOrder(listed);
  const next = expiries[0];
  sendJson(ctx.res, 200, {
    newsroom: { slug: room.slug, name: room.name },
    active: count((l) => l.state === "active"),
    pending_invoice: count((l) => l.state === "pending_invoice"),
    expired: count((l) => l.state === "expired"),
    revoked: count((l) => l.state === "revoked"),
    exclusive: count((l) => l.row.kind === "exclusive" && holdsWindow(l.state)),
    standard: count((l) => l.row.kind === "standard" && holdsWindow(l.state)),
    invoiced_minor: listed.filter((l) => l.row.invoice_raised).reduce((sum, l) => sum + l.row.amount_minor, 0),
    shortlist_count: shortlist.length,
    next_expiry: next ? {
      licence_id: next.row.id, window_end: isoInstant(next.row.window_end), window_end_display: coopTime(next.row.window_end),
    } : null,
    expiries: await licenceBodies(expiries),
  });
});

const FORMULA_START = /^[=+\-@\t\r]/;

/** RFC 4180 cell; a cell starting with = + - @ tab or CR gets a leading apostrophe before quoting. */
function csvCell(value: string): string {
  const text = FORMULA_START.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

const COLUMNS = ["licence_id", "essay_title", "caption", "credit_line", "kind", "state", "confirmed_at", "window_start",
  "window_end", "amount", "currency"];

on("GET", "/api/usage.csv", "none", async (ctx: Ctx) => {
  requireRole(ctx.person, "licensing_manager");
  const room = newsroomOf(ctx.person);
  const now = await serverNow();
  const listed = await newsroomLicences(room.slug, now);
  const [bodies, captions] = await Promise.all([licenceBodies(listed), essayCaptions(listed)]);
  const rows = listed.map((item, i) => {
    // The licence body already carries the revoked placeholder title and a null credit line.
    const body = bodies[i] as { essay_title: string; credit_line: string | null };
    return [item.row.id, body.essay_title, item.state === "revoked" ? "" : captions.get(item.row.essay_id) ?? "",
      body.credit_line ?? "", item.row.kind, item.state,
      coopCsvTime(item.row.confirmed_at), coopCsvTime(item.row.confirmed_at), coopCsvTime(item.row.window_end),
      centsToDecimal(item.row.amount_minor), "USD"];
  });
  const text = [COLUMNS, ...rows].map((r) => `${r.map(csvCell).join(",")}\r\n`).join("");
  const payload = Buffer.from(text, "utf8");
  ctx.res.writeHead(200, {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="saltprint-usage-${room.slug}-${coopDateOf(now)}.csv"`,
    "Content-Length": String(payload.length),
    "Cache-Control": "no-store",
  });
  ctx.res.end(payload);
});
