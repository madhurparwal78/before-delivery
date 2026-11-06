import { formatDisplayTime } from '../shared/time';
import type { AccountRow } from './auth';
import type { Entitlement } from './entitlement';
import { LOCK_CLASS_SWEEP } from './db';
import { forgetExpiredKeys } from './idempotency';
import { publishWarningEmail } from './mail';
import { Publisher } from './publish';
import type { DossierRow } from './serialize';
import type { Services } from './services';
import { applySeedBilling } from './seed';
import { previewPrefix, publishPrefix, StorageUnavailableError } from './storage';

interface SweptAccount {
  account: AccountRow;
  plans: Entitlement | null;
}

export interface SweepResult {
  warnings_sent: number;
  dossiers_taken_down: number;
  objects_removed: number;
}

const DOSSIER_COLUMNS = `id, account_id, slug, root_note_id, state, radius, public_count, severed_count,
  published_at, live_publish_id`;

export class Sweeper {
  private readonly publisher: Publisher;
  private timer: NodeJS.Timeout | null = null;
  private billingSeeded = false;

  constructor(private readonly services: Services) {
    this.publisher = new Publisher(services);
  }

  start(): void {
    const interval = this.services.config.timers.sweepIntervalSeconds * 1000;
    this.timer = setInterval(() => {
      void this.run().catch(() => undefined);
    }, interval);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** One lapse check. Returns null when another sweep already holds the lock. */
  async run(): Promise<SweepResult | null> {
    return this.services.db.withAdvisoryLock(LOCK_CLASS_SWEEP, 'sweep', async () => {
      const startedAt = new Date();
      if (!this.billingSeeded) this.billingSeeded = await applySeedBilling(this.services);

      const accounts = await this.refreshEntitlements(startedAt);
      const warningsSent = await this.sendWarnings(accounts, startedAt);
      const takedowns = await this.takeDownLapsed(accounts, startedAt);
      const objectsRemoved = takedowns.objectsRemoved + (await this.removeOrphanObjects());

      await this.services.mailer.retryUnsent();
      await forgetExpiredKeys(this.services.db, this.services.config.timers.idempotencyTtlSeconds);

      return {
        warnings_sent: warningsSent,
        dossiers_taken_down: takedowns.count,
        objects_removed: objectsRemoved,
      };
    });
  }

  /** Reads entitlement once per account with a non-`none` add-on, refreshing the cache. */
  private async refreshEntitlements(now: Date): Promise<SweptAccount[]> {
    const accounts = await this.services.db.query<AccountRow>(
      `select a.id, a.email, a.display_name, a.password_hash, a.time_zone, a.operator
         from accounts a
        where exists (select 1 from killbill_accounts k where k.account_id = a.id)
           or exists (select 1 from entitlement_cache c where c.account_id = a.id and c.subscribed)`,
    );
    const swept: SweptAccount[] = [];
    const batchSize = 8;
    for (let start = 0; start < accounts.length; start += batchSize) {
      const batch = accounts.slice(start, start + batchSize);
      const plans = await Promise.all(
        batch.map((account) => this.services.entitlement.read(account, now).catch(() => null)),
      );
      batch.forEach((account, index) => swept.push({ account, plans: plans[index] ?? null }));
    }
    return swept;
  }

  private async publishedDossiers(accountId: string): Promise<DossierRow[]> {
    return this.services.db.query<DossierRow>(
      `select ${DOSSIER_COLUMNS} from dossiers where account_id = $1 and state = 'published'`,
      [accountId],
    );
  }

  private async sendWarnings(accounts: readonly SweptAccount[], now: Date): Promise<number> {
    let sent = 0;
    for (const { account, plans } of accounts) {
      const warningAt = plans?.publish.warning_at;
      const takedownAt = plans?.publish.takedown_at;
      if (!plans || !warningAt || !takedownAt) continue;
      if (new Date(warningAt).getTime() > now.getTime()) continue;

      const dossiers = await this.publishedDossiers(account.id);
      if (dossiers.length === 0) continue;

      const inserted = await this.services.db.one<{ account_id: string }>(
        `insert into publish_warnings (account_id, lapse_key, sent_at) values ($1, $2, $3)
           on conflict (account_id, lapse_key) do nothing
           returning account_id`,
        [account.id, takedownAt, now],
      );
      if (!inserted) continue;

      await this.services.mailer.send(
        publishWarningEmail(
          account.email,
          formatDisplayTime(new Date(takedownAt), account.time_zone),
          dossiers.map((dossier) => `${this.services.config.publicUrl}/d/${dossier.slug}/`),
        ),
      );
      sent += 1;
    }
    return sent;
  }

  private async takeDownLapsed(
    accounts: readonly SweptAccount[],
    now: Date,
  ): Promise<{ count: number; objectsRemoved: number }> {
    let count = 0;
    let objectsRemoved = 0;
    for (const { account, plans } of accounts) {
      const takedownAt = plans?.publish.takedown_at;
      if (!plans || !takedownAt || new Date(takedownAt).getTime() > now.getTime()) continue;

      const warned = await this.services.db.one<{ sent_at: Date }>(
        'select sent_at from publish_warnings where account_id = $1 and lapse_key = $2',
        [account.id, takedownAt],
      );
      if (!warned || warned.sent_at.getTime() >= now.getTime()) continue;

      for (const dossier of await this.publishedDossiers(account.id)) {
        const objects = await this.services.store.list(publishPrefix(dossier.slug)).catch(() => null);
        try {
          await this.publisher.withdraw(dossier, 'takedown');
          objectsRemoved += objects?.length ?? 0;
          count += 1;
        } catch {
          // Storage is unreachable: the live pointer stays cleared and the next sweep resumes.
        }
      }
    }
    return { count, objectsRemoved };
  }

  /** Objects of ended preview links and of publish ids that never went live. */
  private async removeOrphanObjects(): Promise<number> {
    let removed = 0;
    const endedLinks = await this.services.db.query<{ id: string }>(
      `select id from preview_links
        where object_keys <> '[]'::jsonb
          and (state <> 'active' or expires_at <= now())`,
    );
    for (const link of endedLinks) {
      try {
        removed += await this.services.store.deletePrefix(previewPrefix(link.id));
        await this.services.db.query(
          `update preview_links set object_keys = '[]'::jsonb,
             state = case when state = 'active' then 'expired' else state end
            where id = $1`,
          [link.id],
        );
      } catch (error) {
        if (!(error instanceof StorageUnavailableError)) throw error;
      }
    }

    const orphans = await this.services.db.query<{ publish_id: string; slug: string }>(
      `select m.publish_id, d.slug
         from publish_manifests m join dossiers d on d.id = m.dossier_id
        where d.live_publish_id is null or d.live_publish_id <> m.publish_id`,
    );
    for (const orphan of orphans) {
      try {
        removed += await this.services.store.deletePrefix(`${publishPrefix(orphan.slug)}${orphan.publish_id}/`);
        await this.services.db.query('delete from publish_manifests where publish_id = $1', [orphan.publish_id]);
      } catch (error) {
        if (!(error instanceof StorageUnavailableError)) throw error;
      }
    }
    return removed;
  }
}
