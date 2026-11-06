// What every handler and job works with: the database, the catalog, the business clock and the providers.
import type { Pool } from "pg";
import type { Config } from "./config.js";
import type { Catalog } from "./domain/catalog.js";
import type { BusinessClock } from "./domain/clock.js";
import type { KillBill } from "./services/killbill.js";
import type { ObjectStore } from "./services/s3.js";
import type { Mailer } from "./services/smtp.js";

export interface App {
  config: Config;
  db: Pool;
  catalog: Catalog;
  clock: BusinessClock;
  killbill: KillBill;
  store: ObjectStore;
  mailer: Mailer;
  /** Wakes the refund and ticket workers after a change that created work for them. */
  nudge(): void;
}
