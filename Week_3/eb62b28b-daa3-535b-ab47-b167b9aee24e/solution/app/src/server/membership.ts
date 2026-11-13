// Membership state transitions. Every state and date here comes from Kill Bill.

import { createHash, randomUUID } from "node:crypto";
import type { Cadence, Membership } from "../shared/api";
import { localDate } from "../shared/time";
import { inTransaction, one, pool, rows, type Db } from "./db";
import { ApiError, conflict, invalid, payments503, refuseWhileClosing } from "./errors";
import type { Reply } from "./http";
import * as killBill from "./killbill";
import { insertMember, isLive, membershipView, memberRow, requireMemberRow, type LiveMember, type MemberRow, type NewMemberFields, type Profile } from "./members";

const CONFIRM_WAIT_MS = 10000;
const CONFIRM_POLL_MS = 500;
const JOIN_LEASE_SECONDS = 30;
const REQUEST_KEY_MAX = 100;
const RECEIPT_LOCK = 71260412;
const FIRST_UNRESERVED_RECEIPT = 5;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const phoenixToday = (): string => localDate(new Date(), "phoenix");

// Each paid invoice gets exactly one receipt. Amounts and lines are copied from the fetched invoice.
async function syncReceipts(row: MemberRow): Promise<void> {
  if (!row.killbill_account_id) return;
  const invoices = await killBill.readInvoices(row.killbill_account_id);
  const paid = invoices.filter(killBill.isPaid);
  for (const invoice of paid) {
    const known = await one(pool, "SELECT 1 FROM receipts WHERE invoice_id = $1", [invoice.invoiceId]);
    if (known) continue;
    const paidAt = await killBill.readPaidAt(invoice.invoiceId);
    if (!paidAt) continue;
    const items = invoice.items.map((item) => ({
      description: item.description ?? item.planName ?? "",
      periodStart: item.startDate ?? null,
      periodEnd: item.endDate ?? null,
      amountCents: item.amount,
    }));
    await inTransaction(async (db) => {
      await db.query("SELECT pg_advisory_xact_lock($1)", [RECEIPT_LOCK]);
      if (await one(db, "SELECT 1 FROM receipts WHERE invoice_id = $1", [invoice.invoiceId])) return;
      const reserved = await one<{ seed_receipt_number: number | null }>(db, "SELECT seed_receipt_number FROM members WHERE id = $1", [row.id]);
      const next = await one<{ number: number }>(db, "SELECT GREATEST(COALESCE(MAX(number), 0) + 1, $1::integer) AS number FROM receipts", [FIRST_UNRESERVED_RECEIPT]);
      await db.query(
        `INSERT INTO receipts (id, number, invoice_id, member_id, paid_at, paid_date, amount_cents, currency, items)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          randomUUID(),
          reserved?.seed_receipt_number ?? next?.number,
          invoice.invoiceId,
          row.id,
          paidAt,
          localDate(paidAt, "phoenix"),
          invoice.amount,
          invoice.currency,
          JSON.stringify(items),
        ],
      );
      await db.query("UPDATE members SET seed_receipt_number = NULL WHERE id = $1", [row.id]);
    });
  }
}

// `pending` becomes `active` only once Kill Bill shows the charged-through date and a paid first invoice.
async function confirmPending(row: MemberRow): Promise<boolean> {
  if (!row.killbill_subscription_id || !row.killbill_account_id) return false;
  const subscription = await killBill.readSubscription(row.killbill_subscription_id);
  const invoices = await killBill.readInvoices(row.killbill_account_id);
  const paid = invoices.some(killBill.isPaid);
  if (!paid || !subscription.chargedThroughDate) return false;
  await pool.query("UPDATE members SET membership_state = 'active', renewal_date = $2 WHERE id = $1 AND membership_state = 'pending'", [
    row.id,
    subscription.chargedThroughDate,
  ]);
  await syncReceipts(row);
  return true;
}

// A later read finishes what a join's wait left pending; an outage just leaves it pending.
export async function freshRow(row: MemberRow): Promise<MemberRow> {
  if (row.membership_state === "cancelled" && row.plus_until !== null && phoenixToday() >= row.plus_until) {
    await pool.query(
      `UPDATE members SET membership_state = 'free', cadence = NULL, renewal_date = NULL, plus_until = NULL, pending_cadence = NULL, pending_from = NULL,
       killbill_subscription_id = NULL WHERE id = $1`,
      [row.id],
    );
  } else if (row.membership_state === "pending") {
    try {
      await confirmPending(row);
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      return row;
    }
  } else {
    return row;
  }
  return requireMemberRow(pool, row.id);
}

// Starts Plus in Kill Bill. A failure before the subscription exists leaves nothing billable behind.
async function startInKillBill(memberId: string, name: string, email: string, cadence: Cadence): Promise<{ accountId: string; subscriptionId: string }> {
  await killBill.uploadCatalogIfMissing();
  const accountId = await killBill.ensureAccount(memberId, name, email, new Date());
  const subscriptionId = await killBill.ensureSubscription(accountId, cadence);
  return { accountId, subscriptionId };
}

async function recordPending(db: Db, memberId: string, cadence: Cadence, ids: { accountId: string; subscriptionId: string }): Promise<void> {
  await db.query(
    `UPDATE members SET membership_state = 'pending', cadence = $2, killbill_account_id = $3, killbill_subscription_id = $4,
     renewal_date = NULL, plus_until = NULL, pending_cadence = NULL, pending_from = NULL, join_started_at = NULL WHERE id = $1`,
    [memberId, cadence, ids.accountId, ids.subscriptionId],
  );
}

async function waitForConfirmation(memberId: string, startedAt: number): Promise<void> {
  for (;;) {
    const row = await memberRow(pool, memberId);
    if (!row) return;
    let confirmed = false;
    try {
      confirmed = await confirmPending(row);
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
    }
    if (confirmed || Date.now() - startedAt >= CONFIRM_WAIT_MS) return;
    await sleep(CONFIRM_POLL_MS);
  }
}

export async function join(member: LiveMember, cadence: Cadence): Promise<Membership> {
  const startedAt = Date.now();
  refuseWhileClosing(member.account_state);
  const leased = await one(
    pool,
    `UPDATE members SET join_started_at = now() WHERE id = $1 AND membership_state = 'free'
     AND (join_started_at IS NULL OR join_started_at < now() - make_interval(secs => $2)) RETURNING id`,
    [member.id, JOIN_LEASE_SECONDS],
  );
  if (!leased) throw conflict("already_plus", "You already have Plus.");
  try {
    const ids = await startInKillBill(member.id, member.name, member.email, cadence);
    try {
      await recordPending(pool, member.id, cadence, ids);
    } catch (error) {
      await killBill.cancelAtOnce(ids.subscriptionId);
      throw error;
    }
  } catch (error) {
    await pool.query("UPDATE members SET join_started_at = NULL WHERE id = $1", [member.id]);
    throw error;
  }
  await waitForConfirmation(member.id, startedAt);
  return membershipView(await requireMemberRow(pool, member.id));
}

// A new member created by the owner with a cadence: Kill Bill first, so an outage leaves no member behind.
export async function createMemberWithPlus(id: string, fields: NewMemberFields, profile: Profile, cadence: Cadence): Promise<void> {
  const startedAt = Date.now();
  const ids = await startInKillBill(id, fields.name, fields.email, cadence);
  try {
    await inTransaction(async (db) => {
      await insertMember(db, id, fields, profile);
      await recordPending(db, id, cadence, ids);
    });
  } catch (error) {
    await killBill.cancelAtOnce(ids.subscriptionId);
    throw error;
  }
  await waitForConfirmation(id, startedAt);
}

// Who may change or cancel Plus at all.
function requireChangeable(member: LiveMember): void {
  refuseWhileClosing(member.account_state);
  if (member.membership_state === "free") throw conflict("not_plus", "You don't have Plus.");
  if (member.membership_state === "cancelled") throw conflict("already_ending", "Plus is already set to end.");
}

// A pending membership is settled with Kill Bill before it can change.
async function settled(member: LiveMember): Promise<MemberRow> {
  if (member.membership_state !== "pending") return member;
  if (!member.killbill_subscription_id) {
    await killBill.uploadCatalogIfMissing();
    throw payments503();
  }
  await confirmPending(member);
  return requireMemberRow(pool, member.id);
}

export async function changeCadence(member: LiveMember, cadence: Cadence): Promise<Membership> {
  requireChangeable(member);
  if (member.cadence === cadence) throw conflict("same_cadence", "You're already on that cadence.");
  const row = await settled(member);
  const subscriptionId = row.killbill_subscription_id;
  if (!subscriptionId) throw payments503();
  await killBill.changePlanAtTermEnd(subscriptionId, cadence);
  const subscription = await killBill.readSubscription(subscriptionId);
  await pool.query("UPDATE members SET pending_cadence = $2, pending_from = $3, renewal_date = $3 WHERE id = $1", [
    row.id,
    cadence,
    subscription.chargedThroughDate ?? null,
  ]);
  return membershipView(await requireMemberRow(pool, row.id));
}

async function endAtTermEnd(row: MemberRow): Promise<void> {
  const subscriptionId = row.killbill_subscription_id;
  if (!subscriptionId) throw payments503();
  await killBill.cancelAtTermEnd(subscriptionId);
  const subscription = await killBill.readSubscription(subscriptionId);
  await pool.query(
    "UPDATE members SET membership_state = 'cancelled', plus_until = $2, renewal_date = NULL, pending_cadence = NULL, pending_from = NULL WHERE id = $1",
    [row.id, subscription.chargedThroughDate ?? null],
  );
}

export async function cancelPlus(member: LiveMember): Promise<Membership> {
  requireChangeable(member);
  const row = await settled(member);
  await endAtTermEnd(row);
  return membershipView(await requireMemberRow(pool, row.id));
}

// The closing request's part in Kill Bill: Plus runs to the end of the paid period.
export async function endPlusForClosure(member: LiveMember): Promise<void> {
  if (member.membership_state === "free" || member.membership_state === "cancelled") return;
  await endAtTermEnd(await settled(member));
}

// A restore always checks with Kill Bill first, and undoes the closure's cancel when it made one.
export async function undoClosureCancel(row: MemberRow, stateBefore: Membership["state"]): Promise<void> {
  await killBill.checkAccountReachable(row.id);
  if ((stateBefore === "active" || stateBefore === "pending") && row.killbill_subscription_id) {
    await killBill.undoCancel(row.killbill_subscription_id);
  }
}

interface StoredKey {
  status: number | null;
  response: unknown;
  body_hash: string;
}

// Rung 9 for a join: the same key and bytes replay the first answer, a different body is refused.
export async function joinWithRequestKey(
  memberId: string,
  key: string | undefined,
  rawBody: Buffer,
  run: () => Promise<Reply>,
): Promise<Reply> {
  if (key === undefined) return run();
  if (key.length > REQUEST_KEY_MAX) throw invalid({ requestKey: `Use a request key of at most ${REQUEST_KEY_MAX} characters.` });
  const hash = createHash("sha256").update(rawBody).digest("hex");
  await pool.query("DELETE FROM request_keys WHERE created_at < now() - interval '24 hours'");
  const claimed = await one(
    pool,
    "INSERT INTO request_keys (member_id, key, body_hash) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING key",
    [memberId, key, hash],
  );
  if (!claimed) return replay(memberId, key, hash);
  try {
    const reply = await run();
    await pool.query("UPDATE request_keys SET status = $3, response = $4 WHERE member_id = $1 AND key = $2", [
      memberId, key, reply.status, JSON.stringify(reply.json),
    ]);
    return reply;
  } catch (error) {
    await pool.query("DELETE FROM request_keys WHERE member_id = $1 AND key = $2", [memberId, key]);
    throw error;
  }
}

async function replay(memberId: string, key: string, hash: string): Promise<Reply> {
  const deadline = Date.now() + CONFIRM_WAIT_MS * 2;
  for (;;) {
    const stored = await one<StoredKey>(pool, "SELECT status, response, body_hash FROM request_keys WHERE member_id = $1 AND key = $2", [memberId, key]);
    if (stored && stored.body_hash !== hash) {
      throw conflict("request_key_reused", "This request key was already used for a different request.");
    }
    if (stored && stored.status !== null) return { status: stored.status, json: stored.response };
    if (!stored || Date.now() > deadline) throw conflict("already_plus", "You already have Plus.");
    await sleep(CONFIRM_POLL_MS);
  }
}

// The check of Kill Bill, at least every 60 seconds: receipts, renewal dates and the plan in force.
export async function reconcileWithKillBill(): Promise<void> {
  const members = await rows<MemberRow>(
    pool,
    `SELECT m.*, p.name, p.email FROM members m JOIN people p ON p.id = m.id
     WHERE m.killbill_account_id IS NOT NULL AND m.account_state IN ('active', 'closing')`,
  );
  for (const row of members) {
    const current = await freshRow(row);
    if (current.membership_state === "free" || !current.killbill_subscription_id) {
      await syncReceipts(current);
      continue;
    }
    const subscription = await killBill.readSubscription(current.killbill_subscription_id);
    if (subscription.planName && subscription.chargedThroughDate) {
      const cadence = killBill.cadenceOfPlan(subscription.planName);
      const switched = current.pending_cadence === cadence;
      if (current.membership_state === "active") {
        await pool.query(
          `UPDATE members SET cadence = $2, renewal_date = $3,
           pending_cadence = CASE WHEN $4 THEN NULL ELSE pending_cadence END,
           pending_from = CASE WHEN $4 THEN NULL ELSE pending_from END WHERE id = $1`,
          [current.id, cadence, subscription.chargedThroughDate, switched],
        );
      }
    }
    await syncReceipts(current);
  }
}

// First start: each seeded Plus member's account and subscription, in the members table's order.
export async function provisionSeededPlus(): Promise<void> {
  const waiting = await rows<MemberRow>(
    pool,
    `SELECT m.*, p.name, p.email FROM members m JOIN people p ON p.id = m.id
     WHERE m.seed_receipt_number IS NOT NULL ORDER BY m.seed_receipt_number`,
  );
  for (const row of waiting) {
    if (!isLive(row) || !row.cadence) continue;
    const startedAt = Date.now();
    const ids = row.killbill_subscription_id && row.killbill_account_id
      ? { accountId: row.killbill_account_id, subscriptionId: row.killbill_subscription_id }
      : await startInKillBill(row.id, row.name, row.email, row.cadence);
    await recordPending(pool, row.id, row.cadence, ids);
    await waitForConfirmation(row.id, startedAt);
    const after = await memberRow(pool, row.id);
    if (after?.membership_state === "active") await syncReceipts(after);
  }
}

