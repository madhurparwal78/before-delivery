import {
  publishAddon,
  syncAddon,
  type AddonName,
  type PublishAddon,
  type SubscriptionFacts,
  type SyncAddon,
} from '../shared/addons';
import type { AccountRow } from './auth';
import type { Config } from './config';
import type { Database } from './db';
import { billingUnavailable } from './errors';
import { BillingUnavailableError, KillBillClient, type SubscriptionRecord } from './killbill';

export interface Entitlement {
  sync: SyncAddon;
  publish: PublishAddon;
  source: 'killbill' | 'cache';
  subscriptionIds: Partial<Record<AddonName, string | null>>;
}

interface CacheRow {
  addon: string;
  subscribed: boolean;
  billing_end_date: string | null;
  checked_at: Date;
}

export class EntitlementReader {
  constructor(
    private readonly db: Database,
    private readonly billing: KillBillClient,
    private readonly config: Config,
  ) {}

  async killBillAccountId(accountId: string): Promise<string | null> {
    const row = await this.db.one<{ kb_account_id: string }>(
      'select kb_account_id from killbill_accounts where account_id = $1',
      [accountId],
    );
    return row?.kb_account_id ?? null;
  }

  async rememberKillBillAccount(accountId: string, kbAccountId: string): Promise<void> {
    await this.db.query(
      `insert into killbill_accounts (account_id, kb_account_id) values ($1, $2)
         on conflict (account_id) do update set kb_account_id = excluded.kb_account_id`,
      [accountId, kbAccountId],
    );
  }

  private async writeCache(accountId: string, records: Record<AddonName, SubscriptionRecord>, checkedAt: Date): Promise<void> {
    for (const addon of ['sync', 'publish'] as AddonName[]) {
      const record = records[addon];
      await this.db.query(
        `insert into entitlement_cache (account_id, addon, subscribed, billing_end_date, checked_at)
           values ($1, $2, $3, $4, $5)
           on conflict (account_id, addon) do update
             set subscribed = excluded.subscribed,
                 billing_end_date = excluded.billing_end_date,
                 checked_at = excluded.checked_at`,
        [accountId, addon, record.subscribed, record.billingEndDate?.slice(0, 10) ?? null, checkedAt],
      );
    }
  }

  private shape(
    account: AccountRow,
    facts: Record<AddonName, SubscriptionFacts>,
    checkedAt: Date,
    source: 'killbill' | 'cache',
    now: Date,
    subscriptionIds: Partial<Record<AddonName, string | null>>,
  ): Entitlement {
    return {
      sync: syncAddon(facts.sync, account.time_zone, this.config.deadlines, checkedAt, source, now),
      publish: publishAddon(facts.publish, account.time_zone, this.config.deadlines, checkedAt, source, now),
      source,
      subscriptionIds,
    };
  }

  /** Reads entitlement from Kill Bill, falling back to the cache during an outage. */
  async read(account: AccountRow, now = new Date()): Promise<Entitlement> {
    const kbAccountId = await this.killBillAccountId(account.id);
    if (!kbAccountId) {
      const none: SubscriptionFacts = { subscribed: false, billingEndDate: null };
      return this.shape(account, { sync: none, publish: none }, now, 'killbill', now, {});
    }
    try {
      const records = await this.billing.readSubscriptions(kbAccountId);
      await this.writeCache(account.id, records, now);
      return this.shape(account, records, now, 'killbill', now, {
        sync: records.sync.subscriptionId,
        publish: records.publish.subscriptionId,
      });
    } catch (error) {
      if (!(error instanceof BillingUnavailableError)) throw error;
      const cached = await this.readCache(account, now);
      if (!cached) throw billingUnavailable();
      return cached;
    }
  }

  async readCache(account: AccountRow, now = new Date()): Promise<Entitlement | null> {
    const rows = await this.db.query<CacheRow>(
      'select addon, subscribed, billing_end_date, checked_at from entitlement_cache where account_id = $1',
      [account.id],
    );
    if (rows.length === 0) return null;
    const facts: Record<AddonName, SubscriptionFacts> = {
      sync: { subscribed: false, billingEndDate: null },
      publish: { subscribed: false, billingEndDate: null },
    };
    let checkedAt = new Date(0);
    for (const row of rows) {
      if (row.addon !== 'sync' && row.addon !== 'publish') continue;
      facts[row.addon] = { subscribed: row.subscribed, billingEndDate: row.billing_end_date };
      if (row.checked_at.getTime() > checkedAt.getTime()) checkedAt = row.checked_at;
    }
    return this.shape(account, facts, checkedAt, 'cache', now, {});
  }
}
