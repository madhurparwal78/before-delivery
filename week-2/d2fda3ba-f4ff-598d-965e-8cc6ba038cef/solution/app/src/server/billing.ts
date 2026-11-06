// Entitlement: read from Kill Bill on every request that needs it, cached for outages, and the
// add-on state and deadline math from Business rules ("Entitlement and deadlines").
import { config } from "./config.ts";
import { pool } from "./db.ts";
import { ApiError } from "./http.ts";
import { BillingUnavailable, current, findAccount, subscriptions, type CairnAccountRef } from "./killbill.ts";
import { isoSeconds, zonedDate, zonedMidnight } from "../shared/time.ts";
import type { AddonName, AddonState, Billing, PublishAddon, SyncAddon } from "../shared/types.ts";

/** What Kill Bill says about one add-on. */
interface AddonFacts {
  subscribed: boolean;
  billingEnd: Date | null;
}

export interface Entitlement {
  facts: Record<AddonName, AddonFacts>;
  checkedAt: Date;
  source: "killbill" | "cache";
}

const ADDONS: AddonName[] = ["sync", "publish"];

/** An account Kill Bill has never billed. */
export const NO_FACTS: Record<AddonName, AddonFacts> = {
  sync: { subscribed: false, billingEnd: null },
  publish: { subscribed: false, billingEnd: null },
};

async function liveFacts(account: CairnAccountRef): Promise<Record<AddonName, AddonFacts>> {
  const kbId = await findAccount(account.id);
  if (!kbId) return NO_FACTS;
  await pool.query("UPDATE accounts SET kb_account_id = $2 WHERE id = $1 AND kb_account_id IS DISTINCT FROM $2", [account.id, kbId]);
  const subs = await subscriptions(kbId);
  const facts = (addon: AddonName): AddonFacts => {
    const sub = current(subs, addon);
    const end = sub?.billingEndDate ?? (sub?.state === "CANCELLED" ? sub.cancelledDate : null);
    return { subscribed: sub !== null && sub.state !== "CANCELLED", billingEnd: end ? new Date(end) : null };
  };
  return { sync: facts("sync"), publish: facts("publish") };
}

/** Live from Kill Bill (refreshing the cache), else the cache; throws BillingUnavailable with neither. */
export async function entitlement(account: CairnAccountRef): Promise<Entitlement> {
  try {
    const facts = await liveFacts(account);
    const checkedAt = new Date();
    for (const addon of ADDONS) {
      await pool.query(
        `INSERT INTO entitlement_cache (account_id, addon, subscribed, billing_end, checked_at) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (account_id, addon) DO UPDATE SET subscribed = $3, billing_end = $4, checked_at = $5`,
        [account.id, addon, facts[addon].subscribed, facts[addon].billingEnd, checkedAt],
      );
    }
    return { facts, checkedAt, source: "killbill" };
  } catch (error) {
    if (!(error instanceof BillingUnavailable)) throw error;
    const cached = await cachedEntitlement(account.id);
    if (!cached) throw error;
    return cached;
  }
}

export async function cachedEntitlement(accountId: string): Promise<Entitlement | null> {
  const { rows } = await pool.query<{ addon: AddonName; subscribed: boolean; billing_end: Date | null; checked_at: Date }>(
    "SELECT addon, subscribed, billing_end, checked_at FROM entitlement_cache WHERE account_id = $1", [accountId]);
  if (rows.length !== ADDONS.length) return null;
  const facts = Object.fromEntries(rows.map((r) => [r.addon, { subscribed: r.subscribed, billingEnd: r.billing_end }])) as Record<AddonName, AddonFacts>;
  const checkedAt = new Date(Math.min(...rows.map((r) => r.checked_at.getTime())));
  return { facts, checkedAt, source: "cache" };
}

interface Deadlines {
  periodEnd: Date;
  writableUntil: Date;
  warningAt: Date;
  takedownAt: Date;
}

/** Period end is 00:00 on Kill Bill's billing end date in the account zone; the rest follow it. */
export function deadlines(billingEnd: Date, timeZone: string): Deadlines {
  const day = zonedDate(billingEnd, timeZone);
  const periodEnd = zonedMidnight(day, timeZone);
  const { syncGrace, publishRetention, publishWarningLead } = config.timers;
  const writableUntil = syncGrace !== null ? new Date(periodEnd.getTime() + syncGrace * 1000) : zonedMidnight(day, timeZone, 7);
  const takedownAt = publishRetention !== null ? new Date(periodEnd.getTime() + publishRetention * 1000) : zonedMidnight(day, timeZone, 14);
  const warningAt = publishWarningLead !== null
    ? new Date(takedownAt.getTime() - publishWarningLead * 1000)
    : zonedMidnight(zonedDate(takedownAt, timeZone), timeZone, -3);
  return { periodEnd, writableUntil, warningAt, takedownAt };
}

function addonState(addon: AddonName, facts: AddonFacts, timeZone: string, now = new Date()): AddonState {
  if (!facts.billingEnd) return facts.subscribed ? "active" : "none";
  const d = deadlines(facts.billingEnd, timeZone);
  if (now < d.periodEnd) return "ending";
  return now < (addon === "sync" ? d.writableUntil : d.takedownAt) ? "grace" : "lapsed";
}

/** The Billing object for an account: { sync: Addon, publish: Addon }. */
export function billingView(ent: Entitlement, timeZone: string): Billing {
  const common = (addon: AddonName) => {
    const facts = ent.facts[addon];
    return {
      state: addonState(addon, facts, timeZone),
      period_end: facts.billingEnd ? isoSeconds(deadlines(facts.billingEnd, timeZone).periodEnd) : null,
      checked_at: isoSeconds(ent.checkedAt),
      source: ent.source,
    };
  };
  const syncEnd = ent.facts.sync.billingEnd ? deadlines(ent.facts.sync.billingEnd, timeZone) : null;
  const publishEnd = ent.facts.publish.billingEnd ? deadlines(ent.facts.publish.billingEnd, timeZone) : null;
  const sync: SyncAddon = { ...common("sync"), writable_until: syncEnd ? isoSeconds(syncEnd.writableUntil) : null };
  const publish: PublishAddon = {
    ...common("publish"),
    warning_at: publishEnd ? isoSeconds(publishEnd.warningAt) : null,
    takedown_at: publishEnd ? isoSeconds(publishEnd.takedownAt) : null,
  };
  return { sync, publish };
}

/** The Billing object for an account, read live from Kill Bill (or the cache during an outage). */
export async function billingFor(account: CairnAccountRef): Promise<Billing> {
  return billingView(await entitlement(account), account.time_zone);
}

async function addonStateFor(account: CairnAccountRef, addon: AddonName): Promise<AddonState> {
  return addonState(addon, (await entitlement(account)).facts[addon], account.time_zone);
}

/** Creating dossiers, preview links and publishes needs Publish active or ending. */
export async function requirePublish(account: CairnAccountRef): Promise<void> {
  const state = await addonStateFor(account, "publish");
  if (state !== "active" && state !== "ending") {
    throw new ApiError(402, "publish_not_entitled", "Publishing needs the Publish add-on.");
  }
}

/**
 * Creating a vault needs the caller's Sync active. Pushes and restores follow the vault owner's
 * Sync: allowed while active, ending or in grace; read-only once lapsed.
 */
export async function requireSync(account: CairnAccountRef, use: "create_vault" | "write"): Promise<void> {
  const state = await addonStateFor(account, "sync");
  if (use === "create_vault" && state !== "active") throw new ApiError(402, "sync_not_entitled", "Creating a vault needs the Sync add-on.");
  if (state === "lapsed") throw new ApiError(403, "vault_read_only", "This vault is read-only because Sync has lapsed.");
  if (state === "none") throw new ApiError(402, "sync_not_entitled", "Syncing needs the Sync add-on.");
}
