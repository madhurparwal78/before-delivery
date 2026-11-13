import type { AppConfig } from './config';
import type { Pool } from './db';
import { KillBill } from './services/killbill';
import { Storage } from './services/storage';
import { Mail } from './services/mail';
import { PocketBase } from './services/pocketbase';
import { MeasureQueue } from './services/queue';
import { Search } from './services/search';
import { Documents } from './services/documents';
import { Alerts } from './services/alerts';

export interface ServiceStatuses {
  postgres: 'up' | 'down';
  killbill: 'up' | 'down';
  minio: 'up' | 'down';
  mailpit: 'up' | 'down';
  pocketbase: 'up' | 'down';
  rabbitmq: 'up' | 'down';
  gotenberg: 'up' | 'down';
  meilisearch: 'up' | 'down';
  ntfy: 'up' | 'down';
}

export interface ClientStatuses {
  billing: 'up' | 'down';
  storage: 'up' | 'down';
  email: 'up' | 'down';
  measuring: 'up' | 'down';
  documents: 'up' | 'down';
}

function defaultStatuses(): ServiceStatuses {
  return {
    postgres: 'up', killbill: 'up', minio: 'up', mailpit: 'up', pocketbase: 'up',
    rabbitmq: 'up', gotenberg: 'up', meilisearch: 'up', ntfy: 'up',
  };
}

/** Cached service probe results, refreshed at most every 5 seconds. */
class StatusCache {
  private cached: ServiceStatuses | null = null;
  private checkedAt = 0;
  private probing = false;

  async get(app: App): Promise<ServiceStatuses> {
    const now = Date.now();
    if (this.cached && now - this.checkedAt < 5_000) {
      return this.cached;
    }
    if (this.probing) {
      return this.cached ?? defaultStatuses();
    }
    this.probing = true;
    try {
      const [postgres, killbill, mailpit, pocketbase, rabbitmq, gotenberg, meilisearch, ntfy, minio] = await Promise.all([
        probe(() => app.pool.query('SELECT 1')),
        app.killbill.healthy(),
        app.mail.healthy(),
        app.pocketbase.healthy(),
        app.queue.healthy(),
        app.documents.healthy(),
        app.search.healthy(),
        app.alerts.healthy(),
        probeMinio(app),
      ]);
      this.cached = {
        postgres: postgres ? 'up' : 'down',
        killbill: killbill ? 'up' : 'down',
        minio: minio ? 'up' : 'down',
        mailpit: mailpit ? 'up' : 'down',
        pocketbase: pocketbase ? 'up' : 'down',
        rabbitmq: rabbitmq ? 'up' : 'down',
        gotenberg: gotenberg ? 'up' : 'down',
        meilisearch: meilisearch ? 'up' : 'down',
        ntfy: ntfy ? 'up' : 'down',
      };
      this.checkedAt = Date.now();
      return this.cached;
    } finally {
      this.probing = false;
    }
  }

  toClientStatuses(statuses: ServiceStatuses): ClientStatuses {
    return {
      billing: statuses.killbill,
      storage: statuses.minio,
      email: statuses.mailpit,
      measuring: statuses.rabbitmq,
      documents: statuses.gotenberg,
    };
  }
}

async function probe(action: () => Promise<unknown>): Promise<boolean> {
  try {
    await action();
    return true;
  } catch {
    return false;
  }
}

async function probeMinio(app: App): Promise<boolean> {
  try {
    await app.storage.statObject('intake/__probe__');
    return true;
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === 'NotFound') {
      return true;
    }
    return false;
  }
}

export class App {
  readonly config: AppConfig;
  readonly pool: Pool;
  readonly killbill: KillBill;
  readonly storage: Storage;
  readonly mail: Mail;
  readonly pocketbase: PocketBase;
  readonly queue: MeasureQueue;
  readonly search: Search;
  readonly documents: Documents;
  readonly alerts: Alerts;
  readonly statuses = new StatusCache();

  schemaReady = false;
  seedsReady = false;
  contentReady = false;

  constructor(config: AppConfig, pool: Pool) {
    this.config = config;
    this.pool = pool;
    this.killbill = new KillBill(config);
    this.storage = new Storage(config);
    this.mail = new Mail(config);
    this.pocketbase = new PocketBase(config);
    this.queue = new MeasureQueue(config);
    this.search = new Search(config);
    this.documents = new Documents(config);
    this.alerts = new Alerts(config);
  }

  async clientStatuses(): Promise<ClientStatuses> {
    const statuses = await this.statuses.get(this);
    return this.statuses.toClientStatuses(statuses);
  }
}
