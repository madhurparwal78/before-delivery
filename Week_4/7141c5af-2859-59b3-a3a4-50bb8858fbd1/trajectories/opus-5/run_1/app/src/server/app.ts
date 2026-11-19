/**
 * The one context every handler is given: configuration, the database and the
 * five providers.
 */
import type { Config } from './config.ts';
import { loadConfig } from './config.ts';
import { createPool, db, type Db, type DbPool } from './db/pool.ts';
import { Mail } from './services/mail.ts';
import { Providers } from './services/providers.ts';
import { Render } from './services/render.ts';
import { Search } from './services/search.ts';
import { Storage } from './services/storage.ts';
import { localDate, parseDate, BUSINESS_ZONE, type CalendarDate } from './domain/time.ts';

export interface App {
  readonly config: Config;
  readonly pool: DbPool;
  readonly db: Db;
  readonly storage: Storage;
  readonly search: Search;
  readonly mail: Mail;
  readonly providers: Providers;
  readonly render: Render;
  /** The server's own clock; no device clock ever decides anything. */
  now(): number;
  /** Today's Turin date. */
  today(): CalendarDate;
  todayText(): string;
}

export function createApp(): App {
  const config = loadConfig();
  const pool = createPool(config.databaseUrl);
  return {
    config,
    pool,
    db: db(pool),
    storage: new Storage(config),
    search: new Search(config),
    mail: new Mail(config),
    providers: new Providers(config),
    render: new Render(config),
    now: () => Date.now(),
    today(): CalendarDate {
      const date = parseDate(localDate(BUSINESS_ZONE, this.now()));
      if (!date) throw new Error('bad business date');
      return date;
    },
    todayText(): string {
      return localDate(BUSINESS_ZONE, this.now());
    },
  };
}
