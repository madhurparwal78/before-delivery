// Shared server types for the API: no circular imports.

import http from 'node:http';
import type { URL } from 'node:url';
import type { Db } from './db.js';
import type { AccountRow } from './projections.js';
import type { Storage } from './services/storage.js';
import type { Mailer } from './services/mailer.js';
import type { KillBill } from './services/killbill.js';
import type { Config } from './config.js';
import type { KillBillSync } from './billing-sync.js';

export interface Ctx {
  db: Db;
  account: AccountRow | null;
}

export interface App {
  config: Config;
  db: Db;
  storage: Storage;
  mailer: Mailer;
  killbill: KillBill;
  kbSync: KillBillSync;
}

export type Handler = (
  app: App,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  ctx: Ctx,
  url: URL,
) => Promise<void>;
