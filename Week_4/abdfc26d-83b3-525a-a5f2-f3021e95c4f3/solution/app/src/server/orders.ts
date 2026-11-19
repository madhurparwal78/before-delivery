import { randomUUID } from "node:crypto";
import { isCountry, VAT_RATES, vatCents } from "../shared/rules.js";
import { requireRole, signedIn, type User } from "./auth.js";
import { config } from "./config.js";
import { iso, one, pool, rows, tx, UUID, type Db, type Tx } from "./db.js";
import { conflict, during, invalidTransition, notFound, paymentsUnavailable, storageUnavailable, validationFailed } from "./errors.js";
import { json, type Ctx, type Route } from "./http.js";
import { idempotent } from "./idempotency.js";
import { invoiceKey, lineOf, renderInvoice } from "./invoices.js";
import * as killbill from "./killbill.js";
import { editionStatuses, pieceBySlug } from "./pieces.js";
import { exportKey } from "./renders.js";
import { objectExists, presign } from "./s3.js";
import { nextNumber } from "./sequences.js";
import { saleSplitFor } from "./splits.js";
import { canMove, DOWNLOADABLE, effectiveState, fromStates, IN_FLIGHT, liveHold, MOVES, type OrderState } from "./order-states.js";

// Edition orders: holds, Buy, confirmation from Kill Bill and owner-only downloads.

export interface OrderRow {
  id: string;
  piece_id: string;
  piece_slug: string;
  piece_title: string;
  edition_count: number;
  collector_id: string;
  edition: number;
  state: OrderState;
  expires_at: Date | null;
  seconds_left: number | null;
  billing_name: string | null;
  email: string | null;
  billing_country: string | null;
  net_cents: number;
  vat_rate_percent: number;
  vat_cents: number;
  gross_cents: number;
  invoice_number: string | null;
  invoice_status: "none" | "pending" | "ready";
  receipt_status: "none" | "queued" | "sent";
  refunded_net_cents: number;
  refunded_vat_cents: number;
  paid_at: Date | null;
  created_at: Date;
  seed: boolean;
  kb_invoice_id: string | null;
  kb_payment_id: string | null;
  export_render_id: string | null;
  export_format: string | null;
}

/** A held order past its expiry reads as expired, whether or not the sweep has written it yet. */
export const ORDER_SELECT = `
  SELECT o.id, o.piece_id, o.collector_id, o.edition, o.expires_at, o.billing_name, o.email, o.billing_country, o.net_cents,
         o.vat_rate_percent, o.vat_cents, o.gross_cents, o.invoice_number, o.invoice_status, o.receipt_status,
         o.refunded_net_cents, o.refunded_vat_cents, o.paid_at, o.created_at, o.seed, o.kb_invoice_id, o.kb_payment_id,
         p.slug AS piece_slug, p.title AS piece_title, p.edition_count, p.export_render_id, r.format AS export_format,
         ${effectiveState("o")} AS state,
         CASE WHEN ${liveHold("o")} THEN CEIL(EXTRACT(EPOCH FROM o.expires_at - now()))::int END AS seconds_left
    FROM orders o JOIN pieces p ON p.id = o.piece_id LEFT JOIN renders r ON r.id = p.export_render_id`;

export const orderView = (o: OrderRow) => ({
  id: o.id,
  piece_slug: o.piece_slug,
  piece_title: o.piece_title,
  edition: o.edition,
  edition_count: o.edition_count,
  state: o.state,
  expires_at: o.state === "held" || o.state === "expired" ? iso(o.expires_at) : null,
  seconds_left: o.seconds_left,
  billing_name: o.billing_name,
  email: o.email,
  billing_country: o.billing_country,
  net_cents: o.net_cents,
  vat_rate_percent: o.vat_rate_percent,
  vat_cents: o.vat_cents,
  gross_cents: o.gross_cents,
  currency: "USD",
  invoice_number: o.invoice_number,
  invoice_status: o.invoice_status,
  receipt_status: o.receipt_status,
  refunded_net_cents: o.refunded_net_cents,
  paid_at: iso(o.paid_at),
  created_at: iso(o.created_at),
});

export async function orderById(db: Db, id: string): Promise<OrderRow | undefined> {
  return UUID.test(id) ? one<OrderRow>(db, `${ORDER_SELECT} WHERE o.id = $1`, [id]) : undefined;
}

/** Writes the expiry of every held order whose timer has run out. */
export async function sweepHolds(db: Db, pieceId?: string): Promise<void> {
  await db.query(
    `UPDATE orders o SET state = $1 WHERE o.state = ANY($2) AND NOT ${liveHold("o")}${pieceId ? " AND o.piece_id = $3" : ""}`,
    [MOVES.expire.to, fromStates("expire"), ...(pieceId ? [pieceId] : [])],
  );
}

/** The available number closest to `wanted`, the lower one on a tie, or null. */
function nearestFree(statuses: { number: number; status: string }[], wanted: number): number | null {
  let best: number | null = null;
  for (const e of statuses) {
    if (e.status !== "available") continue;
    const distance = Math.abs(e.number - wanted);
    if (best === null || distance < Math.abs(best - wanted) || (distance === Math.abs(best - wanted) && e.number < best)) best = e.number;
  }
  return best;
}

// ---- holds ----

async function hold(ctx: Ctx) {
  const user = await signedIn(ctx);
  const piece = await pieceBySlug(pool, ctx.params.slug ?? "");
  const number = Number(ctx.params.n);
  if (!piece || piece.state !== "published" || !Number.isInteger(number) || number < 1 || number > (piece.edition_count ?? 0)) throw notFound();
  requireRole(user, "collector");
  return idempotent(ctx, user, async () => {
    if (piece.creator_id === user.id) throw conflict("own_piece", "You cannot collect your own piece.");
    return tx(async (client) => {
      const locked = await one<{ state: string }>(client, "SELECT state FROM pieces WHERE id = $1 FOR UPDATE", [piece.id]);
      if (locked?.state !== "published") throw notFound();
      await sweepHolds(client, piece.id);
      const mine = await one<{ id: string; edition: number }>(
        client,
        `SELECT o.id, o.edition FROM orders o WHERE o.piece_id = $1 AND o.collector_id = $2 AND ${liveHold("o")}`,
        [piece.id, user.id],
      );
      if (mine?.edition === number) return json(200, { order: orderView((await orderById(client, mine.id)) as OrderRow) });
      const statuses = await editionStatuses(client, piece.id, piece.edition_count ?? 0, user.id);
      if (statuses[number - 1]?.status !== "available") {
        throw conflict("edition_taken", `Edition ${number} was just taken.`, { next_free: nearestFree(statuses, number) });
      }
      if (mine) await client.query("UPDATE orders SET state = $2 WHERE id = $1", [mine.id, MOVES.expire.to]);
      const id = randomUUID();
      await client.query(
        `INSERT INTO orders (id, piece_id, collector_id, edition, state, expires_at, net_cents, gross_cents)
         VALUES ($1, $2, $3, $4, 'held', now() + make_interval(secs => $5), $6, $6)`,
        [id, piece.id, user.id, number, config.holdSeconds, piece.price_cents],
      );
      return json(201, { order: orderView((await orderById(client, id)) as OrderRow) });
    });
  });
}

/** Step 3 for an order: 404 for an unknown id or someone else's order (the founder may read any). */
async function readableOrder(ctx: Ctx, user: User, ownerOnly: boolean): Promise<OrderRow> {
  const order = await orderById(pool, ctx.params.id ?? "");
  const allowed = order && (order.collector_id === user.id || (!ownerOnly && user.roles.includes("founder-operator")));
  if (!order || !allowed) throw notFound();
  return order;
}

async function currentOrder(ctx: Ctx) {
  const user = await signedIn(ctx);
  requireRole(user, "collector");
  const order = await one<OrderRow>(
    pool,
    `${ORDER_SELECT} WHERE p.slug = $1 AND o.collector_id = $2 AND (${liveHold("o")} OR o.state = ANY($3))
     ORDER BY o.created_at DESC LIMIT 1`,
    [ctx.query.get("piece") ?? "", user.id, IN_FLIGHT],
  );
  if (!order) throw notFound();
  return json(200, { order: orderView(order) });
}

async function releaseHold(ctx: Ctx) {
  const user = await signedIn(ctx);
  const order = await readableOrder(ctx, user, true);
  requireRole(user, "collector");
  const released = await one<{ id: string }>(
    pool,
    `UPDATE orders o SET state = $2 WHERE o.id = $1 AND o.state = ANY($3) AND ${liveHold("o")} RETURNING o.id`,
    [order.id, MOVES.expire.to, fromStates("expire")],
  );
  if (!released) throw invalidTransition("Only a held edition can be released.");
  return json(200, { order: orderView((await orderById(pool, order.id)) as OrderRow) });
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function buy(ctx: Ctx) {
  const user = await signedIn(ctx);
  const order = await readableOrder(ctx, user, true);
  requireRole(user, "collector");
  return idempotent(ctx, user, () =>
    tx(async (client) => {
      const locked = (await one<OrderRow>(client, `${ORDER_SELECT} WHERE o.id = $1 FOR UPDATE OF o`, [order.id])) as OrderRow;
      if (locked.state === "expired") throw conflict("hold_expired", "This hold has expired.");
      if (!canMove("buy", locked.state)) throw invalidTransition("Only a held edition can be bought.");
      const body = ctx.body !== null && typeof ctx.body === "object" && !Array.isArray(ctx.body) ? (ctx.body as Record<string, unknown>) : {};
      const fields: Record<string, string> = {};
      const name = typeof body.billing_name === "string" ? body.billing_name.trim() : "";
      const email = typeof body.email === "string" ? body.email.trim() : "";
      const country = typeof body.billing_country === "string" ? body.billing_country : "";
      if (name.length < 1 || name.length > 120) fields.billing_name = "Enter the name for the invoice.";
      if (!EMAIL.test(email) || email.length > 254) fields.email = "Enter an email address.";
      if (!isCountry(country)) fields.billing_country = "We can't invoice that country yet.";
      if (Object.keys(fields).length) throw validationFailed(fields);
      const rate = VAT_RATES[country as keyof typeof VAT_RATES];
      const vat = vatCents(locked.net_cents, rate);
      const gross = locked.net_cents + vat;
      const invoiceId = await during("killbill", paymentsUnavailable, async () => {
        const account = await killbill.ensureAccount(user.id, user.displayName, user.email);
        return killbill.externalCharge(account, gross, lineOf(locked.piece_title, locked.edition, locked.edition_count));
      });
      await client.query(
        `UPDATE orders SET state = $9, billing_name = $2, email = $3, billing_country = $4, vat_rate_percent = $5,
                vat_cents = $6, gross_cents = $7, kb_invoice_id = $8 WHERE id = $1`,
        [order.id, name, email, country, rate, vat, gross, invoiceId, MOVES.buy.to],
      );
      return json(202, { order: orderView((await orderById(client, order.id)) as OrderRow) });
    }),
  );
}

async function getOrder(ctx: Ctx) {
  const user = await signedIn(ctx);
  return json(200, { order: orderView(await readableOrder(ctx, user, false)) });
}

async function myOrders(ctx: Ctx) {
  const user = await signedIn(ctx);
  requireRole(user, "collector");
  const list = await rows<OrderRow>(
    pool,
    `SELECT * FROM (${ORDER_SELECT} WHERE o.collector_id = $1) q WHERE q.state <> $2 ORDER BY q.created_at DESC`,
    [user.id, MOVES.expire.to],
  );
  return json(200, { orders: list.map(orderView) });
}


/** Ownership, then the object in MinIO, then a fresh short-lived link. */
async function download(ctx: Ctx, kind: "export" | "invoice") {
  const user = await signedIn(ctx);
  const order = await readableOrder(ctx, user, true);
  requireRole(user, "collector");
  if (!DOWNLOADABLE.includes(order.state)) throw invalidTransition("This edition is not paid yet.");
  if (kind === "invoice" && order.invoice_status !== "ready") {
    throw conflict("invoice_pending", `Paid, invoice pending. Invoice ${order.invoice_number} will be ready shortly.`, { invoice_number: order.invoice_number });
  }
  const key =
    kind === "export"
      ? exportKey(order.export_render_id ?? "", order.export_format ?? "mp4")
      : invoiceKey(order.invoice_number ?? "", order.paid_at as Date);
  const exists = await during("minio", storageUnavailable, () => objectExists(key));
  if (!exists) throw notFound();
  const filename = kind === "export" ? `${order.piece_slug}-edition-${order.edition}.${order.export_format ?? "mp4"}` : `${order.invoice_number}.pdf`;
  return json(200, presign(key, filename));
}


// ---- confirmation (from a verified callback or a poll; both re-read Kill Bill first) ----

/** Paid in one transaction: the edition assigned, the split rows written and the invoice number taken. */
export async function confirmPaid(orderId: string, paymentId: string): Promise<void> {
  const confirmed = await tx(async (client: Tx) => {
    const order = await one<OrderRow & { creator_id: string; remix_creator_id: string | null }>(
      client,
      `SELECT o.*, p.creator_id, s.creator_id AS remix_creator_id
         FROM orders o JOIN pieces p ON p.id = o.piece_id LEFT JOIN pieces s ON s.id = p.remix_of_id
        WHERE o.id = $1 FOR UPDATE OF o`,
      [orderId],
    );
    if (!order || !canMove("confirm", order.state)) return false;
    const paidAt = (await one<{ now: Date }>(client, "SELECT now() AS now"))?.now as Date;
    const number = await nextNumber(client, "invoice", paidAt.getUTCFullYear());
    await client.query(
      `UPDATE orders SET state = $5, paid_at = $2, invoice_number = $3, invoice_status = 'pending', kb_payment_id = $4 WHERE id = $1`,
      [orderId, paidAt, number, paymentId, MOVES.confirm.to],
    );
    for (const row of saleSplitFor(order.net_cents, order.creator_id, order.remix_creator_id)) {
      await client.query(
        "INSERT INTO split_rows (order_id, party, holder_id, kind, amount_cents, at) VALUES ($1, $2, $3, 'sale', $4, $5)",
        [orderId, row.party, row.holderId, row.amount, paidAt],
      );
    }
    return true;
  });
  if (confirmed) void renderInvoice(orderId);
}

export async function failPayment(orderId: string): Promise<void> {
  await pool.query("UPDATE orders SET state = $2 WHERE id = $1 AND state = ANY($3)", [orderId, MOVES.fail.to, fromStates("fail")]);
}

/** Orders still waiting for Kill Bill, for the confirmation poll. */
export async function payingOrders(): Promise<{ id: string; kb_invoice_id: string }[]> {
  return rows(pool, "SELECT id, kb_invoice_id FROM orders WHERE state = ANY($1) AND kb_invoice_id IS NOT NULL", [fromStates("confirm")]);
}

export const orderRoutes: Route[] = [
  { method: "POST", pattern: "/api/pieces/{slug}/editions/{n}/holds", handler: hold },
  { method: "GET", pattern: "/api/orders/current", handler: currentOrder },
  { method: "GET", pattern: "/api/me/orders", handler: myOrders },
  { method: "DELETE", pattern: "/api/orders/{id}/hold", handler: releaseHold },
  { method: "POST", pattern: "/api/orders/{id}/buy", handler: buy },
  { method: "GET", pattern: "/api/orders/{id}", handler: getOrder },
  { method: "GET", pattern: "/api/orders/{id}/export", handler: (ctx) => download(ctx, "export") },
  { method: "GET", pattern: "/api/orders/{id}/invoice", handler: (ctx) => download(ctx, "invoice") },
];
