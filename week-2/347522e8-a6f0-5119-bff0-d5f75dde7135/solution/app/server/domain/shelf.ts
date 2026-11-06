// Walk-in shelf subscriptions. The app reports a subscription active or ended only as Kill Bill
// confirms; each renter read reconciles the current one with Kill Bill.

import { randomUUID } from "node:crypto";
import type { RenterView, ShelfSubscriptionView } from "../../shared/api.js";
import { iso, now } from "../clock.js";
import { type Db, one, only, pool, rows, transaction } from "../db.js";
import type { JsonObject } from "../http/body.js";
import { fail, invalid } from "../http/errors.js";
import {
  BillingUnavailable,
  KILLBILL_READ_TIMEOUT_MS,
  KILLBILL_TIMEOUT_MS,
  SHELF_PLAN,
  cancelSubscription,
  createShelfSubscription,
  deadlineIn,
  subscriptionState,
} from "../services/killbill.js";
import { billingAccountFor } from "./billing.js";
import { renterRow, renterSummary } from "./renters.js";

interface ShelfRow {
  id: string;
  renter_id: string;
  shelf_label: string;
  external_key: string;
  killbill_subscription_id: string;
  state: "active" | "cancelled";
}

function shelfView(row: ShelfRow, billingState: ShelfSubscriptionView["billing_state"]): ShelfSubscriptionView {
  return {
    shelf_label: row.shelf_label,
    plan: SHELF_PLAN,
    external_key: row.external_key,
    killbill_subscription_id: row.killbill_subscription_id,
    state: row.state,
    billing_state: billingState,
  };
}

function storedShelf(db: Db, renterId: string): Promise<ShelfRow | null> {
  return one<ShelfRow>(db, "SELECT * FROM shelf_subscriptions WHERE renter_id = $1 AND state = 'active'", [renterId]);
}

async function endStored(db: Db, row: ShelfRow): Promise<ShelfRow> {
  await db.query("UPDATE shelf_subscriptions SET state = 'cancelled' WHERE id = $1", [row.id]);
  return { ...row, state: "cancelled" };
}

/**
 * The renter's current subscription as Kill Bill reports it (two-second read). Cancelled in Kill
 * Bill (even directly there) ends it here; unreachable leaves it unchanged with billing `unknown`.
 */
async function currentShelf(renterId: string): Promise<{ row: ShelfRow; view: ShelfSubscriptionView } | null> {
  const row = await storedShelf(pool, renterId);
  if (!row) return null;
  try {
    const state = await subscriptionState(row.killbill_subscription_id, deadlineIn(KILLBILL_READ_TIMEOUT_MS));
    if (state === "CANCELLED") {
      await endStored(pool, row);
      return null;
    }
    return { row, view: shelfView(row, state === "ACTIVE" ? "ACTIVE" : "unknown") };
  } catch (error) {
    if (error instanceof BillingUnavailable) return { row, view: shelfView(row, "unknown") };
    throw error;
  }
}

export async function renterView(renterId: string): Promise<RenterView> {
  const [summary, shelf] = await Promise.all([renterRow(pool, renterId).then((row) => renterSummary(pool, row)), currentShelf(renterId)]);
  return { ...summary, shelf_subscription: shelf?.view ?? null };
}

function billingError(error: unknown): unknown {
  return error instanceof BillingUnavailable ? fail(503, "billing_unavailable") : error;
}

export async function startShelf(renterId: string, body: JsonObject): Promise<ShelfSubscriptionView> {
  const renter = await renterRow(pool, renterId);
  if (renter.status !== "active") throw fail(409, "renter_not_active");
  if (await currentShelf(renterId)) throw fail(409, "already_subscribed");
  const label = typeof body.shelf_label === "string" ? body.shelf_label.trim() : "";
  if (label.length < 1 || label.length > 40) throw invalid({ shelf_label: "Give the shelf a label of up to 40 characters." });
  const started = await rows(pool, "SELECT 1 FROM shelf_subscriptions WHERE renter_id = $1", [renterId]);
  const externalKey = `shelf-${renterId}-${started.length + 1}`;
  const deadline = deadlineIn(KILLBILL_TIMEOUT_MS);
  try {
    const accountId = await transaction((tx) => billingAccountFor(tx, renter, deadline));
    const subscriptionId = await createShelfSubscription(accountId, externalKey, deadline);
    if ((await subscriptionState(subscriptionId, deadline)) !== "ACTIVE") throw new Error(`shelf subscription ${subscriptionId} is not active`);
    const row = await only<ShelfRow>(
      pool,
      `INSERT INTO shelf_subscriptions (id, renter_id, shelf_label, external_key, killbill_subscription_id, state, created_at)
       VALUES ($1, $2, $3, $4, $5, 'active', $6) RETURNING *`,
      [randomUUID(), renterId, label, externalKey, subscriptionId, iso(now())],
    );
    return shelfView(row, "ACTIVE");
  } catch (error) {
    throw billingError(error);
  }
}

export async function endShelf(renterId: string): Promise<ShelfSubscriptionView> {
  const stored = (await currentShelf(renterId))?.row;
  if (!stored) throw fail(409, "not_subscribed");
  const deadline = deadlineIn(KILLBILL_TIMEOUT_MS);
  try {
    await cancelSubscription(stored.killbill_subscription_id, deadline);
    if ((await subscriptionState(stored.killbill_subscription_id, deadline)) !== "CANCELLED") {
      throw new Error(`shelf subscription ${stored.killbill_subscription_id} did not cancel`);
    }
  } catch (error) {
    throw billingError(error);
  }
  return shelfView(await endStored(pool, stored), "CANCELLED");
}
