// Hour pack purchases: one Kill Bill payment per Idempotency-Key, and the purchase, its ledger
// credit and its receipt saved together after billing accepts — or nothing at all.

import { createHash, randomUUID } from "node:crypto";
import type { PackView, PurchaseView } from "../../shared/api.js";
import { formatCents, formatHours } from "../../shared/hours.js";
import { iso, now } from "../clock.js";
import { type Tx, one, pool, transaction } from "../db.js";
import type { JsonObject } from "../http/body.js";
import { FieldErrors, fail } from "../http/errors.js";
import type { Reply } from "../http/pipeline.js";
import {
  BillingUnavailable,
  KILLBILL_TIMEOUT_MS,
  PaymentDeclined,
  billingReachable,
  deadlineIn,
  purchasePayment,
  refundPayment,
} from "../services/killbill.js";
import { billingAccountFor } from "./billing.js";
import { balancesOf, lockRenterHours, recordMovement } from "./ledger.js";
import { queueNotice } from "./outbox.js";
import { type RenterRow, renterRow } from "./renters.js";

interface Pack {
  id: string;
  name: string;
  hours: number;
  amountCents: number;
}

const PACKS: readonly Pack[] = [
  { id: "pack-10", name: "10-hour pack", hours: 10, amountCents: 29_000 },
  { id: "pack-20", name: "20-hour pack", hours: 20, amountCents: 54_000 },
  { id: "pack-40", name: "40-hour pack", hours: 40, amountCents: 100_000 },
];

function packView(pack: Pack): PackView {
  return { id: pack.id, name: pack.name, hours: pack.hours, amount_usd: formatCents(pack.amountCents) };
}

export async function listPacks(): Promise<{ packs: PackView[]; purchases_available: boolean }> {
  return { packs: PACKS.map(packView), purchases_available: await billingReachable() };
}

const KEY = /^[A-Za-z0-9_-]{1,64}$/;

/** Keys sorted at every depth so the same body always has the same fingerprint (kit idempotency module). */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

interface StoredPurchase {
  request_fingerprint: string;
  response_status: number;
  response_body: string;
}

function assertMayBuy(renter: RenterRow): void {
  if (renter.status !== "active" && renter.status !== "suspended") throw fail(409, "renter_not_active");
}

async function save(tx: Tx, renter: RenterRow, pack: Pack, key: string, fingerprint: string, paymentId: string): Promise<string> {
  const id = randomUUID();
  const at = iso(now());
  await lockRenterHours(tx, renter.id);
  await recordMovement(tx, renter.id, "pack_purchase", pack.hours * 60, { purchaseId: id, note: pack.name });
  const { balance_minutes } = await balancesOf(tx, renter.id);
  const purchase: PurchaseView = {
    id,
    pack_id: pack.id,
    pack_name: pack.name,
    hours: pack.hours,
    amount_usd: formatCents(pack.amountCents),
    killbill_payment_id: paymentId,
    created_at: at,
  };
  const response = JSON.stringify({ purchase, balance_minutes });
  await tx.query(
    `INSERT INTO purchases (id, renter_id, idempotency_key, request_fingerprint, pack_id, killbill_payment_id, response_status, response_body, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, 201, $7, $8)`,
    [id, renter.id, key, fingerprint, pack.id, paymentId, response, at],
  );
  await queueNotice(tx, {
    kind: "receipt",
    to: renter.email,
    subject: `Receipt for your ${pack.name}`,
    body: [
      `Thank you, ${renter.business_name}.`,
      "",
      `Pack: ${pack.name}`,
      `Hours: ${pack.hours}`,
      `Amount: $${formatCents(pack.amountCents)} USD`,
      `Kill Bill payment id: ${paymentId}`,
      `New balance: ${formatHours(balance_minutes)} hours`,
    ].join("\n"),
  });
  return response;
}

export async function purchasePack(renterId: string, idempotencyKey: string | undefined, body: JsonObject): Promise<Reply> {
  const pack = PACKS.find((candidate) => candidate.id === body.pack_id);
  const key = idempotencyKey !== undefined && KEY.test(idempotencyKey) ? idempotencyKey : null;
  const invalidRequest = (): Error => {
    const errors = new FieldErrors();
    if (!key) errors.add("idempotency_key", "Send an Idempotency-Key of 1 to 64 letters, digits, - or _.");
    if (!pack) errors.add("pack_id", "Choose the 10-, 20- or 40-hour pack.");
    return errors.error();
  };
  if (!key) {
    assertMayBuy(await renterRow(pool, renterId));
    throw invalidRequest();
  }
  const fingerprint = createHash("sha256").update(canonicalJson(body)).digest("hex");
  return transaction(async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`purchase:${renterId}:${key}`]);
    const stored = await one<StoredPurchase>(
      tx,
      "SELECT request_fingerprint, response_status, response_body FROM purchases WHERE renter_id = $1 AND idempotency_key = $2",
      [renterId, key],
    );
    if (stored) {
      if (stored.request_fingerprint !== fingerprint) throw fail(409, "idempotency_conflict");
      return { status: stored.response_status, raw: stored.response_body };
    }
    const renter = await renterRow(tx, renterId);
    assertMayBuy(renter);
    if (!pack) throw invalidRequest();
    const deadline = deadlineIn(KILLBILL_TIMEOUT_MS);
    let paymentId: string;
    try {
      const accountId = await billingAccountFor(tx, renter, deadline);
      paymentId = await purchasePayment(accountId, formatCents(pack.amountCents), `purchase-${renter.id}-${key}`, deadline);
    } catch (error) {
      if (error instanceof PaymentDeclined) throw fail(402, "payment_failed");
      if (error instanceof BillingUnavailable) throw fail(503, "billing_unavailable");
      throw error;
    }
    try {
      return { status: 201, raw: await save(tx, renter, pack, key, fingerprint, paymentId) };
    } catch (error) {
      await refundPayment(paymentId, formatCents(pack.amountCents), deadlineIn(KILLBILL_TIMEOUT_MS)).catch((refundError: unknown) =>
        console.error(`refund of Kill Bill payment ${paymentId} failed:`, refundError),
      );
      throw error;
    }
  });
}
