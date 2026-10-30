// Group bookers see only their organisation: dashboard totals, attendee search and the CSV export are computed
// on the server from the caller's organisation (finance names one with ?organisation_id=).
import { festivalDayOf } from "../../shared/brussels.ts";
import { decimalEuros } from "../../shared/money.ts";
import { db } from "../db/index.ts";
import { FieldErrors, notFound, ok, route, type SignedInCtx } from "../http.ts";
import { balanceOf, invoicesOfOrganisation } from "./invoices.ts";

const READERS = ["group_booker", "finance"] as const;

async function organisationOf(ctx: SignedInCtx): Promise<{ id: string; name: string }> {
  const id = ctx.user.role === "finance" ? ctx.query.get("organisation_id") : ctx.user.organisation_id;
  if (!id) throw new FieldErrors({ organisation_id: "required" });
  const org = await db.one<{ id: string; name: string }>("SELECT id, name FROM organisations WHERE id = $1", [id]);
  if (!org) throw notFound();
  return org;
}

type AttendeeRow = { name: string; order_ref: string; line_id: string; item_title: string; state: string; kind: string; festival_day: string | null;
  starts_at: Date | null; list_cents: number; group_discount_cents: number; voucher_cents: number; charged_cents: number };

async function attendees(organisationId: string, search: string | null): Promise<AttendeeRow[]> {
  return db.all<AttendeeRow>(
    `SELECT l.holder_name AS name, o.ref AS order_ref, l.id AS line_id, l.title AS item_title, l.state, l.kind, l.festival_day::text,
       s.starts_at, l.list_cents, l.group_discount_cents, l.voucher_cents, l.charged_cents
     FROM lines l JOIN orders o ON o.id = l.order_id LEFT JOIN sessions s ON s.id = l.session_id
     WHERE o.organisation_id = $1 AND ($2::text IS NULL OR strpos(lower(l.holder_name), lower($2)) > 0)
     ORDER BY o.created_at DESC, l.position`, [organisationId, search]);
}

route("GET", "/api/group/dashboard", READERS, async (ctx) => {
  const org = await organisationOf(ctx);
  const counts = (await db.one<{ orders: number; tickets: number }>(
    `SELECT (SELECT count(*) FROM orders WHERE organisation_id = $1)::integer AS orders,
            (SELECT count(*) FROM lines l JOIN orders o ON o.id = l.order_id WHERE o.organisation_id = $1)::integer AS tickets`, [org.id]))!;
  const invoices = await invoicesOfOrganisation(db, org.id);
  const sum = (pick: (i: (typeof invoices)[number]) => number) => invoices.reduce((s, i) => s + pick(i), 0);
  return ok({
    organisation: org, orders: counts.orders, tickets: counts.tickets,
    invoiced_cents: sum((i) => i.amount_cents), credited_cents: sum((i) => i.credited_cents),
    paid_cents: sum((i) => i.paid_cents), outstanding_cents: sum((i) => balanceOf(i)),
  });
});

route("GET", "/api/group/attendees", READERS, async (ctx) => {
  const org = await organisationOf(ctx);
  const q = (ctx.query.get("q") ?? "").trim();
  if (q.length < 2) throw new FieldErrors({ q: "too_short" });
  const rows = await attendees(org.id, q);
  return ok({ attendees: rows.map(({ name, order_ref, line_id, item_title, state }) => ({ name, order_ref, line_id, item_title, state })) });
});

const FORMULA_START = /^[=+\-@\t\r]/;

/** One CSV cell (adapted from kit/modules/csv_safe): formula-looking text is neutralised, quotes doubled. */
function csvCell(value: string): string {
  const s = FORMULA_START.test(value) && !/^-?\d/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

route("GET", "/api/group/export.csv", READERS, async (ctx) => {
  const org = await organisationOf(ctx);
  const header = "order_ref,attendee_name,item,festival_day,list_eur,group_discount_eur,voucher_eur,invoiced_eur,state";
  const rows = (await attendees(org.id, null)).map((r) => [
    r.order_ref, r.name, r.item_title, r.festival_day ?? (r.starts_at ? festivalDayOf(r.starts_at.getTime()) : ""),
    decimalEuros(r.list_cents), decimalEuros(r.group_discount_cents), decimalEuros(r.voucher_cents), decimalEuros(r.charged_cents), r.state,
  ].map(csvCell).join(","));
  return {
    status: 200, contentType: "text/csv; charset=utf-8",
    bytes: Buffer.from([header, ...rows].join("\r\n") + "\r\n"),
    headers: { "Content-Disposition": `attachment; filename="${org.id}-attendees.csv"`, "Cache-Control": "no-store" },
  };
});

