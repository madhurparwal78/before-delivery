// Records closed sessions as Kill Bill usage, exactly once, with retry.

import type { Db } from './db';
import type { KillBillClient } from './killbill';
import type { Storage } from './storage';

export class BillingWorker {
  private timer: NodeJS.Timeout | null = null;
  billingReachable = true;
  private lastProbeAt = 0;

  constructor(
    private db: Db,
    private kb: KillBillClient,
    private billingPrefix: string,
  ) {}

  start(): void {
    this.timer = setInterval(() => void this.retryPending(), 5000);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** billing_reachable, based on a probe no more than 5 seconds old. */
  async reachable(): Promise<boolean> {
    const now = Date.now();
    if (now - this.lastProbeAt > 5000) {
      this.billingReachable = await this.kb.reachable();
      this.lastProbeAt = now;
    }
    return this.billingReachable;
  }

  /** Retries every pending session's usage record every 5 seconds (also on boot). */
  async retryPending(): Promise<void> {
    try {
      const { rows } = await this.db.query<{ id: string; org_id: string; billable_seconds: number; ended_at: Date; plan: string; slug: string }>(
        `SELECT s.id, s.org_id, s.billable_seconds, s.ended_at, s.plan, o.slug
           FROM sessions s JOIN orgs o ON o.id = s.org_id
          WHERE s.billing_state = 'pending' AND s.billable_seconds > 0`,
      );
      for (const r of rows) {
        const subExternalKey = `${this.billingPrefix}-sub-${r.slug}`;
        const { rows: orgRows } = await this.db.query(`SELECT billing_account_id, billing_subscription_id FROM orgs WHERE id=$1`, [r.org_id]);
        const org = orgRows[0];
        if (!org?.billing_subscription_id) continue; // account/subscription not provisioned yet
        const recordDate = r.ended_at.toISOString().slice(0, 10);
        const result = await this.kb.recordUsage(org.billing_subscription_id, r.id, recordDate, r.billable_seconds);
        if (result === 'accepted' || result === 'duplicate') {
          await this.db.query(`UPDATE sessions SET billing_state='confirmed' WHERE id=$1 AND billing_state='pending'`, [r.id]);
          this.billingReachable = true;
          this.lastProbeAt = Date.now();
        } else {
          this.billingReachable = false;
          this.lastProbeAt = Date.now();
          return; // try the rest on the next pulse
        }
      }
    } catch {
      this.billingReachable = false;
      this.lastProbeAt = Date.now();
    }
  }
}
