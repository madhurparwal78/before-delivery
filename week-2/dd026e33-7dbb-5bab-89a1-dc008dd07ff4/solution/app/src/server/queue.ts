// The queue of provider effects (brief: Services › Queue and recovery). Effects live in Postgres;
// each is claimed by one process at a time, effects of one car run in order (account, subscription,
// first invoice, cancellation), a failed attempt releases its claim, and a process only claims
// effects for services its own status probe can reach.
import type { BayClass } from "../shared/domain.js";
import { one, pool, type Db } from "./db.js";
import { ProviderDown } from "./errors.js";
import {
  cancelSubscription,
  ensureAccount,
  ensureCatalog,
  ensureSubscription,
  PLAN_PRICE_CENTIMES,
  subscription,
  type PlanName,
} from "./killbill.js";
import { send, type Message } from "./mail.js";
import { serviceStatus } from "./status.js";

export const PLAN_OF_CLASS: Record<BayClass, PlanName> = {
  standard: "bay-standard-monthly",
  covered_lift: "bay-covered-lift-monthly",
  sealed_capsule: "bay-sealed-capsule-monthly",
};

type EffectKind = "subscription_create" | "subscription_cancel" | "email";

interface EffectRow {
  [key: string]: unknown;
  id: string;
  kind: EffectKind;
  car_id: string | null;
  payload: Message | Record<string, never>;
}

const POLL_MS = 1000;
const RETRY_AFTER = "3 seconds";
const AWAIT_KILLBILL = "1 second";

export async function enqueueEmail(db: Db, message: Message): Promise<void> {
  await db.query("INSERT INTO provider_effects (kind, payload) VALUES ('email', $1)", [JSON.stringify(message)]);
}

export async function enqueueSubscriptionCreate(db: Db, carId: string): Promise<void> {
  await db.query("INSERT INTO provider_effects (kind, car_id) VALUES ('subscription_create', $1)", [carId]);
}

export async function enqueueSubscriptionCancel(db: Db, carId: string): Promise<void> {
  await db.query("INSERT INTO provider_effects (kind, car_id) VALUES ('subscription_cancel', $1)", [carId]);
}

/** The id of the owner's account in Kill Bill, created in Kill Bill the first time it is needed. */
export async function accountFor(db: Db, ownerId: string): Promise<string> {
  const known = await one<{ account_id: string }>(db, "SELECT account_id FROM killbill_accounts WHERE owner_id = $1", [ownerId]);
  if (known) return known.account_id;
  const owner = await one<{ id: string; name: string; email: string }>(db, "SELECT id, name, email FROM users WHERE id = $1", [ownerId]);
  if (!owner) throw new Error(`no owner ${ownerId}`);
  const accountId = await ensureAccount(owner);
  await db.query("INSERT INTO killbill_accounts (owner_id, account_id) VALUES ($1, $2) ON CONFLICT (owner_id) DO NOTHING", [ownerId, accountId]);
  return accountId;
}

async function claim(kinds: EffectKind[]): Promise<EffectRow | null> {
  return one<EffectRow>(
    pool,
    `UPDATE provider_effects SET claimed_until = clock_timestamp() + interval '60 seconds', attempts = attempts + 1
      WHERE id = (
        SELECT e.id FROM provider_effects e
         WHERE e.done_at IS NULL AND e.available_at <= clock_timestamp()
           AND (e.claimed_until IS NULL OR e.claimed_until < clock_timestamp())
           AND e.kind = ANY($1)
           AND NOT EXISTS (SELECT 1 FROM provider_effects p WHERE p.car_id = e.car_id AND p.id < e.id AND p.done_at IS NULL)
         ORDER BY e.id
         LIMIT 1
         FOR UPDATE SKIP LOCKED)
      RETURNING id::text, kind, car_id, payload`,
    [kinds],
  );
}

async function done(id: string): Promise<void> {
  await pool.query("UPDATE provider_effects SET done_at = clock_timestamp(), claimed_until = NULL WHERE id = $1", [id]);
}

async function later(id: string, after: string): Promise<void> {
  await pool.query(`UPDATE provider_effects SET claimed_until = NULL, available_at = clock_timestamp() + interval '${after}' WHERE id = $1`, [
    id,
  ]);
}

interface BillingCar {
  [key: string]: unknown;
  id: string;
  owner_id: string;
  billing_plan: PlanName;
  kb_subscription_id: string | null;
}

/** Returns true when the effect is complete, false when it waits on Kill Bill to catch up. */
async function apply(effect: EffectRow): Promise<boolean> {
  if (effect.kind === "email") {
    await send(effect.payload as Message);
    return true;
  }
  const car = await one<BillingCar>(pool, "SELECT id, owner_id, billing_plan, kb_subscription_id FROM cars WHERE id = $1", [effect.car_id]);
  if (!car) return true;
  if (effect.kind === "subscription_create") {
    const accountId = await accountFor(pool, car.owner_id);
    const state = car.kb_subscription_id
      ? await subscription(car.kb_subscription_id)
      : await ensureSubscription(accountId, car.id, car.billing_plan);
    await pool.query("UPDATE cars SET kb_subscription_id = $2 WHERE id = $1", [car.id, state.subscriptionId]);
    if (!state.chargedThroughDate) return false;
    await pool.query(
      `UPDATE cars SET charged_through_date = $2, billing_monthly_centimes = $3,
              billing_status = CASE WHEN billing_status = 'pending' THEN 'active' ELSE billing_status END
        WHERE id = $1`,
      [car.id, state.chargedThroughDate.slice(0, 10), PLAN_PRICE_CENTIMES[car.billing_plan].toString()],
    );
    return true;
  }
  // subscription_cancel: sent only once Kill Bill shows the charged-through date (the create effect,
  // earlier in this car's order, waited for it).
  if (!car.kb_subscription_id) throw new Error(`car ${car.id} has no subscription to cancel`);
  let state = await subscription(car.kb_subscription_id);
  if (!state.billingEndDate) {
    await cancelSubscription(car.kb_subscription_id);
    state = await subscription(car.kb_subscription_id);
  }
  if (!state.billingEndDate) return false;
  await pool.query(
    "UPDATE cars SET billing_end_date = $2, charged_through_date = coalesce($3, charged_through_date), billing_status = 'ending' WHERE id = $1",
    [car.id, state.billingEndDate.slice(0, 10), state.chargedThroughDate?.slice(0, 10) ?? null],
  );
  return true;
}

let catalogReady = false;

async function drain(): Promise<void> {
  const status = await serviceStatus();
  const kinds: EffectKind[] = [];
  if (status.billing === "up") {
    if (!catalogReady) {
      await ensureCatalog();
      catalogReady = true;
    }
    kinds.push("subscription_create", "subscription_cancel");
  }
  if (status.mail === "up") kinds.push("email");
  if (kinds.length === 0) return;
  for (let effect = await claim(kinds); effect; effect = await claim(kinds)) {
    try {
      if (await apply(effect)) await done(effect.id);
      else await later(effect.id, AWAIT_KILLBILL);
    } catch (error) {
      if (!(error instanceof ProviderDown)) console.error(`effect ${effect.id} (${effect.kind}): ${(error as Error).message}`);
      await later(effect.id, RETRY_AFTER);
    }
  }
}

/** Runs the queue in this process until it exits. */
export function startQueue(): void {
  const tick = (): void => {
    drain()
      .catch((error: unknown) => {
        if (!(error instanceof ProviderDown)) console.error(`queue: ${(error as Error).message}`);
      })
      .finally(() => setTimeout(tick, POLL_MS));
  };
  tick();
}
