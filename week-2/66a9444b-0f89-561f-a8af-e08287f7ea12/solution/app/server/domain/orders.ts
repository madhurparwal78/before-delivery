// Orders, their lines and passes: the line state machine, the derived order status, visibility, the Order view.
import { FULL_PASS_ONLY_VENUE } from "../../shared/admission.ts";
import { dateText, dayLabel, sessionTimeText } from "../../shared/brussels.ts";
import type { User } from "../auth.ts";
import { db, type Db } from "../db/index.ts";
import { ApiError, notFound, ok, route } from "../http.ts";
import { passPdf, type PassFace } from "../services/passPdf.ts";
import { getObject, objectKeys } from "../services/storage.ts";
import { isoOrNull, isoUtc } from "./time.ts";

type LineState = "authorised" | "captured" | "proof_pending" | "voided" | "expired" | "transferred" | "refunded";

/** Legal line moves (brief: Order lines and order status); every other move is refused with 409. */
const LINE_MOVES: Record<LineState, readonly LineState[]> = {
  authorised: ["captured", "proof_pending"],
  proof_pending: ["captured", "voided", "expired"],
  captured: ["transferred", "refunded"],
  transferred: ["refunded"],
  voided: [],
  expired: [],
  refunded: [],
};

/** The lines whose state does not allow a move to `to`. */
export function refusedMoves<L extends { id: string; state: LineState }>(lines: readonly L[], to: LineState): L[] {
  return lines.filter((l) => !LINE_MOVES[l.state].includes(to));
}

/** Moves lines to `to`; a line whose state does not allow the move refuses the whole change. */
export async function moveLines(q: Db, lineIds: readonly string[], to: LineState): Promise<void> {
  const from = (Object.keys(LINE_MOVES) as LineState[]).filter((state) => LINE_MOVES[state].includes(to));
  const moved = await q.query("UPDATE lines SET state = $2 WHERE id = ANY($1) AND state = ANY($3)", [lineIds, to, from]);
  if (moved.rowCount !== lineIds.length) throw new ApiError(409, "line_state_conflict");
}

type OrderStatus = "proof_pending" | "voided" | "refunded" | "refunded_partial" | "confirmed";

function orderStatus(states: readonly string[]): OrderStatus {
  if (states.includes("proof_pending")) return "proof_pending";
  if (states.every((s) => s === "voided" || s === "expired")) return "voided";
  const remaining = states.filter((s) => s !== "voided" && s !== "expired");
  if (remaining.every((s) => s === "refunded")) return "refunded";
  if (states.includes("refunded")) return "refunded_partial";
  return "confirmed";
}

type OrderRow = {
  id: string; ref: string; buyer_id: string; buyer_name: string; buyer_email: string; organisation_id: string | null;
  rate: "full" | "reduced"; voucher_code: string | null; proof_deadline: Date | null; kb_payment_id: string | null;
  confirmation_outbox_id: number | null; created_at: Date;
};

export type LineRow = {
  id: string; order_id: string; position: number; kind: "seat" | "full_festival" | "day"; session_id: string | null;
  festival_day: string | null; title: string; holder_name: string; state: LineState; list_cents: number;
  group_discount_cents: number; voucher_cents: number; charged_cents: number; pass_code: string | null; pass_status: string | null;
};

const ORDER_SELECT = `SELECT o.id, o.ref, o.buyer_id, u.name AS buyer_name, u.email AS buyer_email, o.organisation_id, o.rate,
  o.voucher_code, o.proof_deadline, o.kb_payment_id, o.confirmation_outbox_id, o.created_at FROM orders o JOIN users u ON u.id = o.buyer_id`;

export async function linesOf(q: Db, orderIds: readonly string[]): Promise<LineRow[]> {
  return q.all<LineRow>(
    `SELECT l.id, l.order_id, l.position, l.kind, l.session_id, l.festival_day::text, l.title, l.holder_name, l.state, l.list_cents,
       l.group_discount_cents, l.voucher_cents, l.charged_cents, p.code AS pass_code, p.status AS pass_status
     FROM lines l LEFT JOIN LATERAL (SELECT code, status FROM passes WHERE line_id = l.id ORDER BY created_at DESC LIMIT 1) p ON true
     WHERE l.order_id = ANY($1) ORDER BY l.position`, [orderIds]);
}

export function lineView(l: LineRow) {
  return {
    id: l.id, position: l.position, kind: l.kind, session_id: l.session_id, festival_day: l.festival_day, title: l.title,
    holder_name: l.holder_name, state: l.state, list_cents: l.list_cents, group_discount_cents: l.group_discount_cents,
    voucher_cents: l.voucher_cents, charged_cents: l.charged_cents,
    pass: l.pass_code ? { code: l.pass_code, status: l.pass_status } : null,
  };
}

type RefundRow = { id: string; order_id: string; line_ids: string[]; card_cents: number; voucher_cents: number; credit_note_id: string | null; status: string; reason: string; created_at: Date };

export function refundView(r: RefundRow) {
  return { id: r.id, order_id: r.order_id, line_ids: r.line_ids, card_cents: r.card_cents, voucher_cents: r.voucher_cents,
    credit_note_id: r.credit_note_id, status: r.status, reason: r.reason, created_at: isoUtc(r.created_at) };
}

export const REFUND_SELECT = "SELECT id, order_id, line_ids, card_cents, voucher_cents, credit_note_id, status, reason, created_at FROM refunds";

export async function orderViews(q: Db, orders: readonly OrderRow[]) {
  if (!orders.length) return [];
  const ids = orders.map((o) => o.id);
  const lines = await linesOf(q, ids);
  const refunds = await q.all<RefundRow>(`${REFUND_SELECT} WHERE order_id = ANY($1) ORDER BY created_at`, [ids]);
  const mail = await q.all<{ id: number; sent: boolean }>("SELECT id, sent_at IS NOT NULL AS sent FROM outbox WHERE id = ANY($1::bigint[])",
    [orders.map((o) => String(o.confirmation_outbox_id ?? 0))]);
  const invoices = await q.all<{ id: string; order_id: string }>("SELECT id, order_id FROM invoices WHERE order_id = ANY($1)", [ids]);
  return orders.map((o) => {
    const own = lines.filter((l) => l.order_id === o.id);
    const sum = (key: "list_cents" | "group_discount_cents" | "voucher_cents" | "charged_cents") => own.reduce((s, l) => s + l[key], 0);
    return {
      id: o.id, ref: o.ref, buyer_name: o.buyer_name, organisation_id: o.organisation_id, rate: o.rate,
      status: orderStatus(own.map((l) => l.state)),
      subtotal_cents: sum("list_cents"), group_discount_cents: sum("group_discount_cents"), voucher_code: o.voucher_code,
      voucher_cents: sum("voucher_cents"), total_cents: sum("charged_cents"), proof_deadline: isoOrNull(o.proof_deadline),
      confirmation_mail: mail.find((m) => m.id === o.confirmation_outbox_id)?.sent ? "sent" : "pending",
      invoice_id: invoices.find((i) => i.order_id === o.id)?.id ?? null,
      created_at: isoUtc(o.created_at), lines: own.map(lineView),
      refunds: refunds.filter((r) => r.order_id === o.id).map(refundView),
    };
  });
}

export async function orderView(q: Db, orderId: string) {
  const row = await q.one<OrderRow>(`${ORDER_SELECT} WHERE o.id = $1`, [orderId]);
  return (await orderViews(q, [row!]))[0]!;
}

/** An order is visible to its buyer, to group bookers of its organisation, and to finance; to anyone else it is not found. */
export async function visibleOrder(q: Db, user: User, orderId: string, lock = false): Promise<OrderRow> {
  const row = await q.one<OrderRow>(`${ORDER_SELECT} WHERE o.id = $1${lock ? " FOR UPDATE OF o" : ""}`, [orderId]);
  if (!row || !canSee(user, row)) throw notFound();
  return row;
}

function canSee(user: User, order: { buyer_id: string; organisation_id: string | null }): boolean {
  return user.role === "finance" || order.buyer_id === user.id || (user.role === "group_booker" && order.organisation_id !== null && order.organisation_id === user.organisation_id);
}

async function ordersVisibleTo(q: Db, user: User): Promise<OrderRow[]> {
  if (user.role === "group_booker") {
    return q.all<OrderRow>(`${ORDER_SELECT} WHERE o.buyer_id = $1 OR o.organisation_id = $2 ORDER BY o.created_at DESC`, [user.id, user.organisation_id]);
  }
  return q.all<OrderRow>(`${ORDER_SELECT} WHERE o.buyer_id = $1 ORDER BY o.created_at DESC`, [user.id]);
}

export async function searchOrders(q: Db, term: string): Promise<OrderRow[]> {
  return q.all<OrderRow>(`${ORDER_SELECT} WHERE $1 = '' OR o.ref ILIKE $2 OR u.email ILIKE $2 ORDER BY o.created_at DESC LIMIT 200`,
    [term, `%${term.replace(/[%_\\]/g, "\\$&")}%`]);
}

const VIEWERS = ["visitor", "group_booker", "finance"] as const;

route("GET", "/api/orders", ["visitor", "group_booker"], async (ctx) => ok({ orders: await orderViews(db, await ordersVisibleTo(db, ctx.user)) }));

route("GET", "/api/orders/:id", VIEWERS, async (ctx) => {
  const order = await visibleOrder(db, ctx.user, ctx.params.id!);
  return ok((await orderViews(db, [order]))[0]);
});

route("GET", "/api/orders/:id/passes/:code", VIEWERS, async (ctx) => {
  const order = await visibleOrder(db, ctx.user, ctx.params.id!);
  const pass = await db.one("SELECT p.code FROM passes p JOIN lines l ON l.id = p.line_id WHERE p.code = $1 AND l.order_id = $2", [ctx.params.code!, order.id]);
  if (!pass) throw notFound();
  const bytes = await getObject(objectKeys.pass(order.ref, ctx.params.code!));
  return { status: 200, bytes, contentType: "application/pdf", headers: { "Content-Disposition": `attachment; filename="${ctx.params.code}.pdf"`, "Cache-Control": "no-store" } };
});

type FaceSource = { kind: string; title: string; holder_name: string; festival_day: string | null; session_id: string | null };

/** What a pass shows: holder, item, session time or festival day, venue and code — nothing else. */
export async function passFace(q: Db, line: FaceSource, code: string): Promise<PassFace> {
  if (line.kind === "seat") {
    const s = (await q.one<{ starts_at: Date; ends_at: Date; venue: string }>(
      "SELECT s.starts_at, s.ends_at, v.name AS venue FROM sessions s JOIN venues v ON v.id = s.venue_id WHERE s.id = $1", [line.session_id]))!;
    return { holder: line.holder_name, item: line.title, when: sessionTimeText(s.starts_at.getTime(), s.ends_at.getTime()), venue: s.venue, code };
  }
  if (line.kind === "day") {
    const dome = (await q.one<{ name: string }>("SELECT name FROM venues WHERE id = $1", [FULL_PASS_ONLY_VENUE]))?.name ?? FULL_PASS_ONLY_VENUE;
    return { holder: line.holder_name, item: line.title, when: `${dayLabel(line.festival_day!)} · 05:00 to 05:00 next morning`, venue: `Every venue except ${dome}`, code };
  }
  const e = (await q.one<{ first_day: Date; last_day: Date }>("SELECT first_day::timestamptz AS first_day, last_day::timestamptz AS last_day FROM edition WHERE id = 1"))!;
  return { holder: line.holder_name, item: line.title, when: `${dateText(e.first_day.getTime())} to ${dateText(e.last_day.getTime())}`, venue: "Every venue", code };
}

export async function passDocument(q: Db, line: FaceSource, code: string): Promise<Buffer> {
  return passPdf(await passFace(q, line, code));
}
