import type { PoolClient } from "pg";
import { newId } from "../config";
import { now } from "../clock";
import { pool, q, one, tx } from "../db";
import { lockName } from "../lockname";
import { ApiError, conflict } from "../errors";
import type { ChargeRow, PackAttemptRow, PersonRow, StudioRow } from "../types";
import { chooseFunding, balanceOf, postMovement } from "./ledger";
import * as kb from "../services/killbill";
import { sendMail } from "../services/mailer";
import { publish } from "../events";
import { dollars } from "../money";
import { formatScreenDate } from "../studiodays";

// Charges: created pending, settled exactly once with one Kill Bill purchase, one
// ledger pair and one receipt email — all as one unit.

export const chargeTxKey = (charge: Pick<ChargeRow, "id" | "firing" | "piece_id" | "storage_day">): string =>
  charge.firing === "storage" ? `kd-storage-${charge.piece_id}-${charge.storage_day}` : `kd-charge-${charge.id}`;

export const refundTxKey = (chargeId: string): string => `kd-refund-${chargeId}`;

// Create a pending charge (caller's transaction).
export async function insertCharge(
  client: PoolClient,
  args: {
    studioId: string;
    memberId: string;
    pieceId: string;
    firing: "bisque" | "glaze" | "storage";
    storageDay?: string | null;
    cubicEighths?: number | null;
    rateCents: number;
    feeCents: number;
    at: Date;
  },
): Promise<ChargeRow | null> {
  const id = newId();
  const rows = await q<ChargeRow>(
    client,
    `INSERT INTO charges (id, studio_id, member_id, piece_id, firing, storage_day, cubic_eighths, rate_cents, fee_cents, status, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'pending',$10)
     ON CONFLICT DO NOTHING
     RETURNING *`,
    [id, args.studioId, args.memberId, args.pieceId, args.firing, args.storageDay ?? null, args.cubicEighths ?? null, args.rateCents, args.feeCents, args.at],
  );
  return rows[0] ?? null;
}

// Choose the funding of a charge once, under the member's money lock, at the moment
// the first Kill Bill PURCHASE call is sent.
async function ensureFunding(charge: ChargeRow, member: PersonRow): Promise<"credit" | "card"> {
  if (charge.funding) return charge.funding;
  return tx(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [lockName.member(charge.member_id)]);
    const fresh = await one<ChargeRow>(client, "SELECT * FROM charges WHERE id = $1", [charge.id]);
    if (!fresh) throw new ApiError(404, "not_found", "Charge missing.");
    if (fresh.funding) return fresh.funding;
    const balance = await balanceOf(client, charge.member_id);
    const funding = chooseFunding(balance, fresh.fee_cents, member.card_status);
    await client.query("UPDATE charges SET funding = $1 WHERE id = $2", [funding, charge.id]);
    return funding;
  });
}

async function settleInDb(charge: ChargeRow, funding: "credit" | "card", at: Date): Promise<{ ok: boolean; balanceCents: number }> {
  return tx(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [lockName.member(charge.member_id)]);
    const updated = await one<ChargeRow>(
      client,
      "UPDATE charges SET status = 'settled', funding = $1, settled_at = $2 WHERE id = $3 AND status = 'pending' RETURNING *",
      [funding, at, charge.id],
    );
    if (!updated) {
      const balance = await balanceOf(client, charge.member_id);
      return { ok: false, balanceCents: balance };
    }
    const kind = charge.firing === "storage" ? "storage_fee" : "firing_fee";
    const posted = await postMovement(client, {
      studioId: charge.studio_id,
      memberId: charge.member_id,
      kind,
      amountCents: charge.fee_cents,
      chargeId: charge.id,
      funding,
      at,
    });
    return { ok: true, balanceCents: posted.balanceCents };
  });
}

async function sendChargeReceipt(charge: ChargeRow, member: PersonRow, studio: StudioRow, funding: "credit" | "card", balanceCents: number): Promise<void> {
  const piece = await one<{ title: string }>(pool, "SELECT title FROM pieces WHERE id = $1", [charge.piece_id]);
  const title = piece?.title ?? "Piece";
  const fee = dollars(charge.fee_cents);
  const fundingLine = funding === "credit" ? "Paid from credit" : "Paid by card";
  const balanceAfter = dollars(balanceCents);
  if (charge.firing === "storage" && charge.storage_day) {
    await sendMail(
      member.email,
      `Storage fee: ${title}`,
      `${studio.name}\nStorage, ${formatScreenDate(charge.storage_day)}\nFee ${fee}\n${fundingLine}\nBalance after ${balanceAfter}\n`,
    );
  } else {
    await sendMail(
      member.email,
      `Firing receipt: ${title}`,
      `${studio.name}\n${charge.firing} firing\nFee ${fee}\n${fundingLine}\nBalance after ${balanceAfter}\n`,
    );
  }
}

export type SettleOutcome = "settled" | "pending";

// Try to settle one charge. On the unload request path a fresh charge is purchased
// directly (5-second limit per call); the settler adopts first (30-second limit).
export async function settleCharge(charge: ChargeRow, kbTimeoutMs: number, opts?: { adoptFirst?: boolean }): Promise<SettleOutcome> {
  const member = await one<PersonRow>(pool, "SELECT * FROM people WHERE id = $1", [charge.member_id]);
  const studio = await one<StudioRow>(pool, "SELECT * FROM studios WHERE id = $1", [charge.studio_id]);
  if (!member || !studio) return "pending";
  const txKey = chargeTxKey(charge);
  let funding: "credit" | "card";
  try {
    funding = await ensureFunding(charge, member);
  } catch {
    return "pending";
  }
  let success = false;
  try {
    if (opts?.adoptFirst) {
      if (await kb.lookupPurchase(txKey, kbTimeoutMs)) {
        success = true; // adoption
      } else {
        const outcome = await kb.purchase({ id: member.id, name: member.name, email: member.email }, txKey, charge.fee_cents, kbTimeoutMs);
        success = outcome.result === "success";
      }
    } else {
      const outcome = await kb.purchase({ id: member.id, name: member.name, email: member.email }, txKey, charge.fee_cents, kbTimeoutMs);
      success = outcome.result === "success";
    }
  } catch {
    return "pending";
  }
  if (!success) return "pending";
  const at = now();
  const result = await settleInDb(charge, funding, at);
  if (!result.ok) return "settled"; // another instance settled it first
  void sendChargeReceipt(charge, member, studio, funding, result.balanceCents).catch(() => {});
  await publish(pool, "charge", charge.id, charge.studio_id, { memberId: charge.member_id });
  await publish(pool, "credit", charge.member_id, charge.studio_id, { memberId: charge.member_id });
  return "settled";
}

export const chargeNotFound = (): ApiError => new ApiError(404, "not_found", "Charge not found.");
export const billingUnavailable = (): ApiError => new ApiError(503, "billing_unavailable", "Billing is unavailable. Try again in a few minutes.");
export const refundableError = (): ApiError => conflict("charge_not_refundable", "Only a settled charge can be refunded.");

export type { PackAttemptRow };
