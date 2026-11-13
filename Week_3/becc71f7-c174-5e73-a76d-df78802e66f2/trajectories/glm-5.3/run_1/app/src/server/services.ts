import type { Pool } from './db.js';
import type { Storage } from './storage.js';
import type { Mailer } from './mailer.js';
import type { Config } from './config.js';

export interface Services {
  pool: Pool;
  storage: Storage;
  mailer: Mailer;
  config: Config;
}
