import { now, nowMs } from "../clock";
import { pool, one, tx } from "../db";
import { lockName } from "../lockname";
import { ApiError, conflict } from "../errors";
import type { ChargeRow, PersonRow, StudioRow } from "../types";
import { postMovement } from "./ledger";
import * as kb from "../services/killbill";
import { chargeTxKey, refundTxKey } from "./charges";
import { publish } from "../events";
import { dollars } from "../money";
import { sendMail } from "../services/mailer";
import { formatScreenDate } from "../studiodays";

// Refunds: only a settled charge, in full, with one Kill Bill REFUND, one reversing
// pair and one receipt — recorded together.

export type RefundResponse = { status: number; body: Record<string, unknown> };

export async function memberBalance(memberId: string): Promise<number> {
  const row = await one<{ b: string }>(
    pool,
    "SELECT COALESCE(SUM(e.amount_cents),0) AS b FROM ledger_entries e JOIN movements m ON m.id=e.movement_id WHERE e.account='member_credit' AND m.member_id=$1",
    [memberId],
  );
  return Number(row?.b ?? 0);
}

async function refundReceipt(charge: ChargeRow, member: PersonRow, studio: StudioRow, balanceCents: number): Promise<void> {
  const piece = await one<{ title: string }>(pool, "SELECT title FROM pieces WHERE id = $1", [charge.piece_id]);
  const title = piece?.title ?? "Piece";
  const fee = dollars(charge.fee_cents);
  const fundingLine = charge.funding === "card" ? "Paid by card" : "Paid from credit";
  if (charge.firing === "storage" && charge.storage_day) {
    await sendMail(member.email, `Refund: ${title}`, `${studio.name}\nStorage, ${formatScreenDate(charge.storage_day)}\nRefund ${fee}\n${fundingLine}\nBalance after ${dollars(balanceCents)}\n`);
  } else {
    await sendMail(member.email, `Refund: ${title}`, `${studio.name}\n${charge.firing} firing\nRefund ${fee}\n${fundingLine}\nBalance after ${dollars(balanceCents)}\n`);
  }
}

export async function refundCharge(charge: ChargeRow): Promise<RefundResponse> {
  const member = await one<PersonRow>(pool, "SELECT * FROM people WHERE id = $1", [charge.member_id]);
  const studio = await one<StudioRow>(pool, "SELECT * FROM studios WHERE id = $1", [charge.studio_id]);
  if (!member || !studio) throw new ApiError(404, "not_found", "Charge not found.");
  if (charge.status !== "settled") {
    throw conflict("charge_not_refundable", "Only a settled charge can be refunded.");
  }
  const chargeKey = chargeTxKey(charge);
  const rKey = refundTxKey(charge.id);
  try {
    const result = await kb.refund(chargeKey, rKey, charge.fee_cents, 5000);
    if (result === "success") {
      const body = await completeRefund(charge, member, studio);
      return { status: 200, body };
    }
    throw new ApiError(503, "billing_unavailable", "Billing is unavailable. Try again in a few minutes; a charge is never refunded twice.");
  } catch (e) {
    if (e instanceof kb.KbCallFailed && e.kind === "timeout") {
      // Sent but no answer within 5 seconds: refund_pending, no pair posted.
      await pool.query("UPDATE charges SET status = 'refund_pending', last_kb_call_ms = $1 WHERE id = $2 AND status = 'settled'", [nowMs(), charge.id]);
      const fresh = await one<ChargeRow>(pool, "SELECT * FROM charges WHERE id = $1", [charge.id]);
      const balance = await memberBalance(charge.member_id);
      return { status: 202, body: { charge: fresh, balance_cents: balance } };
    }
    if (e instanceof ApiError) throw e;
    throw new ApiError(503, "billing_unavailable", "Billing is unavailable. Try again in a few minutes; a charge is never refunded twice.");
  }
}

// Record the REFUND, the reversing pair and the receipt together.
export async function completeRefund(charge: ChargeRow, member: PersonRow, studio: StudioRow): Promise<Record<string, unknown>> {
  const balanceCents = await tx(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [lockName.member(charge.member_id)]);
    const updated = await one<ChargeRow>(
      client,
      "UPDATE charges SET status = 'refunded', refunded_at = $1 WHERE id = $2 AND status IN ('settled','refund_pending') RETURNING *",
      [now(), charge.id],
    );
    if (!updated) return 0 - 1; // caller refetches
    const posted = await postMovement(client, {
      studioId: charge.studio_id,
      memberId: charge.member_id,
      kind: "refund",
      amountCents: charge.fee_cents,
      chargeId: charge.id,
      funding: updated.funding ?? "credit",
      at: now(),
    });
    return posted.balanceCents;
  });
  const balance = balanceCents === -1 ? await memberBalance(charge.member_id) : balanceCents;
  void refundReceipt(charge, member, studio, balance).catch(() => {});
  await publish(pool, "charge", charge.id, charge.studio_id, { memberId: charge.member_id });
  await publish(pool, "credit", charge.member_id, charge.studio_id, { memberId: charge.member_id });
  const fresh = await one<ChargeRow>(pool, "SELECT * FROM charges WHERE id = $1", [charge.id]);
  return { charge: fresh, balance_cents: balance };
}

// The settler's work for one refund_pending charge: adopt the REFUND recorded under
// the key, or make it with the same key when a lookup at least 30 seconds after the
// request's last call finds none.
export async function settleRefund(charge: ChargeRow): Promise<void> {
  const member = await one<PersonRow>(pool, "SELECT * FROM people WHERE id = $1", [charge.member_id]);
  const studio = await one<StudioRow>(pool, "SELECT * FROM studios WHERE id = $1", [charge.studio_id]);
  if (!member || !studio) return;
  const chargeKey = chargeTxKey(charge);
  const rKey = refundTxKey(charge.id);
  let found = false;
  try {
    found = await kb.lookupRefund(rKey, chargeKey, 30000);
  } catch {
    return;
  }
  if (!found) {
    const lastCall = charge.last_kb_call_ms ?? 0;
    if (nowMs() - lastCall < 30000) return;
    try {
      const result = await kb.refund(chargeKey, rKey, charge.fee_cents, 30000);
      if (result !== "success") {
        await pool.query("UPDATE charges SET last_kb_call_ms = $1 WHERE id = $2", [nowMs(), charge.id]);
        return;
      }
      found = true;
    } catch {
      await pool.query("UPDATE charges SET last_kb_call_ms = $1 WHERE id = $2", [nowMs(), charge.id]);
      return;
    }
  }
  if (found) {
    await completeRefund(charge, member, studio);
  }
}
