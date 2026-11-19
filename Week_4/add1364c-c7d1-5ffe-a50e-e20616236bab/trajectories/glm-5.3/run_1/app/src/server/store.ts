import { randomUUID } from 'node:crypto';
import pg from 'pg';
import type { PoolClient } from 'pg';
import type { Settings } from './config.js';
import { ServerClock } from './clock.js';
import { applySchema } from './schema.js';
import { SecretBox } from './domain/secretBox.js';
import { AuditTrail, type Actor, type AuditEntryDraft } from './domain/audit.js';
import { KeycloakClient } from './services/keycloak.js';
import { KillBillClient } from './services/killbill.js';
import { BreachFeedClient } from './services/breachFeed.js';
import { EventHub } from './events.js';
import { officeDateString } from './officeTime.js';
import { ruleInForceAt } from './domain/rules.js';

// Postgres `date` columns arrive as `YYYY-MM-DD` strings, never as Date objects.
pg.types.setTypeParser(pg.types.builtins.DATE, (value: string) => value);
pg.types.setTypeParser(pg.types.builtins.INT8, (value: string) => Number(value));
pg.types.setTypeParser(pg.types.builtins.INT4, (value: string) => Number(value));

export interface ActorPerson {
  id: string;
  full_name: string;
  role: string;
}

/**
 * The store: one Postgres pool plus the office's service clients and domain
 * helpers. Every state change runs in a transaction with its audit entries.
 */
export class Store {
  readonly pool: pg.Pool;
  readonly clock: ServerClock;
  readonly audit: AuditTrail;
  readonly secrets: SecretBox;
  readonly keycloak: KeycloakClient;
  readonly killbill: KillBillClient;
  readonly feed: BreachFeedClient;
  readonly events: EventHub;
  readonly settings: Settings;
  private schemaReady: Promise<void> | null = null;

  constructor(settings: Settings) {
    this.settings = settings;
    this.pool = new pg.Pool({ connectionString: settings.databaseUrl, max: 10 });
    this.clock = new ServerClock(settings);
    this.audit = new AuditTrail(this.pool, this.clock);
    this.secrets = new SecretBox(settings.locksetSecretKey, settings.authClientSecret);
    this.keycloak = new KeycloakClient(settings);
    this.killbill = new KillBillClient(settings);
    this.feed = new BreachFeedClient(settings);
    this.events = new EventHub();
  }

  /** Apply the schema without losing data; health answers once this is done. */
  ready(): Promise<void> {
    if (!this.schemaReady) {
      this.schemaReady = applySchema(this.pool).catch((error) => {
        this.schemaReady = null;
        throw error;
      });
    }
    return this.schemaReady;
  }

  async withClient<T>(run: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      return await run(client);
    } finally {
      client.release();
    }
  }

  async transaction<T>(run: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await run(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  actorOf(person: ActorPerson | null): Actor {
    if (!person) return { system: 'Lockset' };
    return { personId: person.id, name: person.full_name };
  }

  /** Write audit entries inside the caller's transaction. */
  async writeAudit(client: PoolClient, actor: Actor, drafts: Array<Omit<AuditEntryDraft, 'actor'>>): Promise<void> {
    await this.audit.write(client, drafts.map((draft) => ({ ...draft, actor })));
  }

  newId(): string {
    return randomUUID();
  }

  /**
   * Run one breach check. Checks never overlap: a check requested while another
   * is running waits for that run and answers with its result.
   */
  async runBreachCheckNow(): Promise<{ ok: boolean; checkedAt: Date }> {
    if (this.checkRunning) {
      return this.checkRunning;
    }
    const run = this.performBreachCheck();
    this.checkRunning = run;
    try {
      return await run;
    } finally {
      this.checkRunning = null;
    }
  }

  private checkRunning: Promise<{ ok: boolean; checkedAt: Date }> | null = null;

  private async performBreachCheck(): Promise<{ ok: boolean; checkedAt: Date }> {
    const now = this.clock.now();
    const day = officeDateString(now);
    const credentials = await this.pool.query('SELECT c.*, v.domain AS vendor_domain FROM credentials c JOIN vendors v ON v.id = c.vendor_id');
    const health: Record<string, string> = {};
    let exposed = 0;
    let vendorBreached = 0;
    const domains = await this.feed.breachedDomains();
    if (domains === null) {
      await this.pool.query(
        'INSERT INTO breach_checks (id, ran_at, office_day, feed_ok, counts, credential_health) VALUES ($1,$2,$3,false,$4,$5)',
        [randomUUID(), now, day, JSON.stringify({ exposed: 0, vendor_breached: 0, out_of_policy: 0, turns_due: 0, turns_overdue: 0 }), JSON.stringify({})]
      );
      this.broadcastCheckFinished('unreachable');
      return { ok: false, checkedAt: now };
    }
    for (const row of credentials.rows) {
      const secret = this.secrets.decrypt(row.secret_enc as Buffer);
      const isExposed = await this.feed.isExposed(secret);
      const domainBreached = domains.has(String(row.vendor_domain).toLowerCase());
      if (isExposed === null) {
        await this.pool.query(
          'INSERT INTO breach_checks (id, ran_at, office_day, feed_ok, counts, credential_health) VALUES ($1,$2,$3,false,$4,$5)',
          [randomUUID(), now, day, JSON.stringify({ exposed: 0, vendor_breached: 0, out_of_policy: 0, turns_due: 0, turns_overdue: 0 }), JSON.stringify({})]
        );
        this.broadcastCheckFinished('unreachable');
        return { ok: false, checkedAt: now };
      }
      if (isExposed) {
        health[String(row.id)] = 'exposed';
        exposed += 1;
      } else if (domainBreached) {
        health[String(row.id)] = 'vendor_breached';
        vendorBreached += 1;
      }
    }
    const counts = await this.healthCounts(health, exposed, vendorBreached);
    await this.pool.query(
      'INSERT INTO breach_checks (id, ran_at, office_day, feed_ok, counts, credential_health) VALUES ($1,$2,$3,true,$4,$5)',
      [randomUUID(), now, day, JSON.stringify(counts), JSON.stringify(health)]
    );
    this.broadcastCheckFinished('ok');
    return { ok: true, checkedAt: now };
  }

  private async healthCounts(health: Record<string, string>, exposed: number, vendorBreached: number): Promise<Record<string, number>> {
    const today = officeDateString(this.clock.now());
    const rulesRows = await this.pool.query('SELECT * FROM rules');
    const rules = rulesRows.rows.map((row) => ({
      id: String(row.id),
      vault_id: String(row.vault_id),
      min_length: Number(row.min_length),
      effective_on: String(row.effective_on).slice(0, 10),
      state: row.state as never,
      version: Number(row.version),
      drafted_by: '',
      signed_by: null
    }));
    const credentials = await this.pool.query('SELECT id, vault_id, secret_enc, last_turned_on, out_of_policy_since FROM credentials');
    let outOfPolicy = 0;
    for (const row of credentials.rows) {
      const secret = this.secrets.decrypt(row.secret_enc as Buffer);
      const rule = ruleInForceAt(rules, String(row.vault_id), today);
      if (rule && secret.length < rule.min_length) outOfPolicy += 1;
    }
    const dueRows = await this.pool.query("SELECT COUNT(*)::int AS n FROM turns WHERE state = 'due'");
    const overdueRows = await this.pool.query("SELECT COUNT(*)::int AS n FROM turns WHERE state = 'overdue'");
    return {
      exposed,
      vendor_breached: vendorBreached,
      out_of_policy: outOfPolicy,
      turns_due: Number(dueRows.rows[0].n),
      turns_overdue: Number(overdueRows.rows[0].n)
    };
  }

  private broadcastCheckFinished(feed: 'ok' | 'unreachable'): void {
    void this.pool
      .query("SELECT id FROM people WHERE role IN ('office_manager','managing_partner') AND status <> 'left'")
      .then((rows) => {
        for (const row of rows.rows) {
          this.events.send(String(row.id), 'check-finished', { feed });
        }
      });
  }
}
