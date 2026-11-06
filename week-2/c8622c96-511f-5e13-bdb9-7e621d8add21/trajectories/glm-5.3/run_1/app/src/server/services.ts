import type { Sql } from "./db.js";
import type { Storage } from "./storage.js";
import type { Billing } from "./billing.js";
import type { Mailer } from "./mail.js";
import type { Clock } from "./clock.js";

// The four providers, bundled once and handed to every route module.
export interface Services {
  sql: Sql;
  storage: Storage;
  billing: Billing;
  mailer: Mailer;
  clock: Clock;
}
