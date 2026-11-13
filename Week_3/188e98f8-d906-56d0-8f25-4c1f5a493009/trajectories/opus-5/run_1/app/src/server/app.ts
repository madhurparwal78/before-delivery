/** What every request handler is given. */

import type { Config } from './config.js';
import type { Db } from './db.js';
import type { MailSink } from './mail.js';
import type { SheetStore } from './storage.js';

export interface App {
  config: Config;
  db: Db;
  store: SheetStore;
  mail: MailSink;
  /** True once the schema and seed are in place on the database. */
  ready(): boolean;
}
