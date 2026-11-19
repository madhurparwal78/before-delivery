import { randomUUID } from "node:crypto";
import { luhnValid, money, RANGES } from "../../shared/rules.js";
import { requireRole, signedIn } from "../auth.js";
import { accountFor } from "../billing.js";
import { Check } from "../body.js";
import { one, pool, rows, tx, UUID } from "../db.js";
import { conflict, HttpError, invalid, notFound } from "../errors.js";
import { json, type Ctx, type Route } from "../http.js";
import { idempotent } from "../idempotency.js";
import * as killbill from "../killbill.js";
import { account, balanceOf, lockMember, post } from "../ledger.js";
import { enqueueEmail } from "../outbox.js";
import { objectExists, presign } from "../s3.js";
import { Changes, publishLater } from "../stream.js";
import { iso, memberById, venueById, type MemberRow, type VenueRow } from "../views.js";

interface DepositRow {
  id: string;
  venue_id: string;
  member_id: string;
  amount_cents: number;
  refunded_cents: number;
  status: "succeeded" | "declined";
  card_last4: string;
  killbill_payment_id: string | null;
  created_at: Date;
}

const DEPOSIT_SELECT = `SELECT d.*, coalesce((SELECT sum(amount_cents) FROM refunds r WHERE r.deposit_id = d.id), 0) AS refunded_cents FROM deposits d`;

const depositView = (d: DepositRow) => ({
  id: d.id,
  amount_cents: d.amount_cents,
  refunded_cents: d.refunded_cents,
  status: d.status,
  card_last4: d.card_last4,
  killbill_payment_id: d.killbill_payment_id,
  created_at: iso(d.created_at),
});

function venueTime(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone, dateStyle: "long", timeStyle: "short" }).format(at);
}

/** A PURCHASE on the member's own Kill Bill account; the ledger is credited only on SUCCESS. */
export async function chargeDeposit(member: MemberRow, venue: VenueRow, amount: number, last4: string): Promise<DepositRow> {
  const venueId = venue.id;
  const accountId = await accountFor(member, venue);
  const depositId = randomUUID();
  const result = await killbill.purchase(accountId, depositId, amount, last4);
  const changes = new Changes();
  const deposit = await tx(async (client) => {
    const row = (await one<DepositRow>(
      client,
      `INSERT INTO deposits (id, venue_id, member_id, amount_cents, status, card_last4, killbill_payment_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *, 0 AS refunded_cents`,
      [depositId, venueId, member.id, amount, result.success ? "succeeded" : "declined", last4, result.paymentId],
    )) as DepositRow;
    if (!result.success) return row;
    await post(client, venueId, "deposit", depositId, [[account.cardClearing, -amount], [account.available(member.id), amount]]);
    const { available_cents } = await balanceOf(client, member.id);
    await enqueueEmail(client, venueId, {
      to: member.email,
      subject: `Deposit received — ${money(amount)}`,
      text: [
        `Your deposit to ${venue.name} is confirmed.`,
        "",
        `Amount: ${money(amount)}`,
        `Card: ending ${last4}`,
        `Deposit id: ${depositId}`,
        `Time: ${venueTime(row.created_at, venue.time_zone)}`,
        `New available balance: ${money(available_cents)}`,
        "",
      ].join("\n"),
    });
    changes.members.add(member.id);
    return row;
  });
  publishLater(changes);
  return deposit;
}

/** Credits the house balance only after Kill Bill records a successful PURCHASE. */
async function createDeposit(ctx: Ctx) {
  const auth = signedIn(ctx);
  return idempotent(ctx, auth.memberId, "deposits", "payments_unavailable", async (keyError) => {
    const venueId = requireRole(auth, "trader", "builder");
    const check = new Check(ctx.body, ["amount_cents", "card_number"], keyError);
    const amount = check.int("amount_cents", RANGES.deposit.min, RANGES.deposit.max);
    const card = typeof check.body.card_number === "string" ? check.body.card_number : "";
    if (!luhnValid(card)) check.fail("card_number", "invalid");
    check.done();
    const member = await memberById(pool, auth.memberId);
    const venue = await venueById(pool, venueId);
    const deposit = await chargeDeposit(member, venue, amount, card.replace(/ /g, "").slice(-4));
    if (deposit.status === "declined") throw new HttpError(402, { error: "payment_declined", deposit_id: deposit.id });
    return json(201, depositView(deposit));
  });
}

async function listDeposits(ctx: Ctx) {
  const auth = signedIn(ctx);
  requireRole(auth);
  const deposits = await rows<DepositRow>(pool, `${DEPOSIT_SELECT} WHERE d.member_id = $1 ORDER BY d.created_at DESC`, [auth.memberId]);
  return json(200, { deposits: deposits.map(depositView) });
}

async function getDeposit(ctx: Ctx) {
  const auth = signedIn(ctx);
  const id = ctx.params.id ?? "";
  const deposit = UUID.test(id) ? await one<DepositRow>(pool, `${DEPOSIT_SELECT} WHERE d.id = $1 AND d.member_id = $2`, [id, auth.memberId]) : undefined;
  if (!deposit) throw notFound();
  requireRole(auth);
  return json(200, depositView(deposit));
}

async function adminDeposits(ctx: Ctx) {
  const venueId = requireRole(signedIn(ctx), "market_admin");
  const q = (ctx.query.get("q") ?? "").trim();
  const deposits = await rows<DepositRow & { display_name: string; email: string }>(
    pool,
    `SELECT x.*, m.display_name, m.email FROM (${DEPOSIT_SELECT}) x JOIN members m ON m.id = x.member_id
      WHERE x.venue_id = $1 AND ($2 = '' OR m.display_name ILIKE '%' || $2 || '%' OR m.email ILIKE '%' || $2 || '%')
      ORDER BY x.created_at DESC LIMIT 200`,
    [venueId, q.replace(/[\\%_]/g, (c) => `\\${c}`)],
  );
  return json(200, {
    deposits: deposits.map((d) => ({ ...depositView(d), member: { id: d.member_id, display_name: d.display_name, email: d.email } })),
  });
}

/** A Kill Bill REFUND capped by the deposit's remainder and the member's available balance. */
async function refundDeposit(ctx: Ctx) {
  const auth = signedIn(ctx);
  const id = ctx.params.id ?? "";
  const found = UUID.test(id) && auth.venueId ? await one<DepositRow>(pool, `${DEPOSIT_SELECT} WHERE d.id = $1 AND d.venue_id = $2`, [id, auth.venueId]) : undefined;
  if (!found) throw notFound();
  const venueId = requireRole(auth, "market_admin");
  if (found.status !== "succeeded") throw conflict("deposit_not_refundable");
  const check = new Check(ctx.body, ["amount_cents"]);
  const amount = check.int("amount_cents", 1, Number.MAX_SAFE_INTEGER);
  check.done();
  const member = await memberById(pool, found.member_id);
  const venue = await venueById(pool, venueId);
  const changes = new Changes();
  const refund = await tx(async (client) => {
    await lockMember(client, member.id);
    const current = (await one<DepositRow>(client, `${DEPOSIT_SELECT} WHERE d.id = $1`, [found.id])) as DepositRow;
    const { available_cents } = await balanceOf(client, member.id);
    if (amount > Math.min(current.amount_cents - current.refunded_cents, available_cents)) throw invalid({ amount_cents: "exceeds_refundable" });
    const refundId = randomUUID();
    const result = await killbill.refund(current.killbill_payment_id ?? "", refundId, amount);
    if (!result.success || !result.transactionId) throw new HttpError(402, { error: "payment_declined" });
    const row = await one<{ id: string; deposit_id: string; amount_cents: number; killbill_transaction_id: string; created_at: Date }>(
      client,
      "INSERT INTO refunds (id, venue_id, deposit_id, amount_cents, killbill_transaction_id) VALUES ($1, $2, $3, $4, $5) RETURNING id, deposit_id, amount_cents, killbill_transaction_id, created_at",
      [refundId, venueId, found.id, amount, result.transactionId],
    );
    await post(client, venueId, "refund", refundId, [[account.available(member.id), -amount], [account.cardClearing, amount]]);
    await enqueueEmail(client, venueId, {
      to: member.email,
      subject: `Refund issued — ${money(amount)}`,
      text: `A refund of ${money(amount)} on your deposit ${found.id} to ${venue.name} has been issued to your card ending ${found.card_last4}.\n`,
    });
    changes.members.add(member.id);
    return row as NonNullable<typeof row>;
  });
  publishLater(changes);
  return json(201, { ...refund, created_at: iso(refund.created_at) });
}

async function adminDocuments(ctx: Ctx) {
  const venueId = requireRole(signedIn(ctx), "market_admin");
  const docs = await rows<{ id: string; member_id: string; display_name: string; filename: string; content_type: string; size_bytes: number; uploaded_at: Date }>(
    pool,
    `SELECT d.id, d.member_id, m.display_name, d.filename, d.content_type, d.size_bytes, d.uploaded_at
       FROM documents d JOIN members m ON m.id = d.member_id WHERE d.venue_id = $1 ORDER BY d.uploaded_at DESC`,
    [venueId],
  );
  return json(200, {
    documents: docs.map((d) => ({
      id: d.id,
      member: { id: d.member_id, display_name: d.display_name },
      filename: d.filename,
      content_type: d.content_type,
      size_bytes: d.size_bytes,
      uploaded_at: iso(d.uploaded_at),
    })),
  });
}

async function documentLink(ctx: Ctx) {
  const auth = signedIn(ctx);
  const id = ctx.params.id ?? "";
  const doc = UUID.test(id) && auth.venueId ? await one<{ member_id: string }>(pool, "SELECT member_id FROM documents WHERE id = $1 AND venue_id = $2", [id, auth.venueId]) : undefined;
  if (!doc) throw notFound();
  const venueId = requireRole(auth, "market_admin");
  const key = `venues/${venueId}/documents/${doc.member_id}/${id}`;
  if (!(await objectExists(key))) throw notFound();
  const link = presign(key, 60);
  return json(200, { url: link.url, expires_at: link.expiresAt.toISOString() });
}

export const depositRoutes: Route[] = [
  { method: "POST", pattern: "/api/deposits", auth: "session", handler: createDeposit, outage: "payments_unavailable" },
  { method: "GET", pattern: "/api/deposits", auth: "session", handler: listDeposits },
  { method: "GET", pattern: "/api/deposits/{id}", auth: "session", handler: getDeposit },
  { method: "POST", pattern: "/api/deposits/{id}/refunds", auth: "session", handler: refundDeposit, outage: "payments_unavailable" },
  { method: "GET", pattern: "/api/admin/deposits", auth: "session", handler: adminDeposits },
  { method: "GET", pattern: "/api/admin/documents", auth: "session", handler: adminDocuments },
  { method: "GET", pattern: "/api/admin/documents/{id}/link", auth: "session", handler: documentLink, outage: "documents_unavailable" },
];
