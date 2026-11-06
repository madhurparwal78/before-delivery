import type { Config } from './config';
import type { Database } from './db';
import { EntitlementReader } from './entitlement';
import { KillBillClient } from './killbill';
import { Mailer } from './mail';
import { ObjectStore } from './storage';

export interface Services {
  config: Config;
  db: Database;
  store: ObjectStore;
  billing: KillBillClient;
  entitlement: EntitlementReader;
  mailer: Mailer;
  /** Reader assets shipped with each published dossier. */
  readerAssets: { css: string; script: string };
}

export function buildServices(config: Config, db: Database, readerAssets: { css: string; script: string }): Services {
  const store = new ObjectStore(config.s3);
  const billing = new KillBillClient(config.killbill);
  return {
    config,
    db,
    store,
    billing,
    entitlement: new EntitlementReader(db, billing, config),
    mailer: new Mailer(db, config),
    readerAssets,
  };
}
