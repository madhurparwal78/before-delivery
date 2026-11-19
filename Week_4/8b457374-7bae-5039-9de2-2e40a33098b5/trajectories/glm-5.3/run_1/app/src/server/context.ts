import pg, { type Pool } from "pg";
import { loadConfig, type Config } from "./config.js";
import { KillBillClient } from "./killbill.js";
import { MailClient } from "./mail.js";
import { StorageClient } from "./storage.js";
import { DocumentsClient } from "./documents.js";
import { ServiceHealth } from "./health.js";

export interface AppContext {
  config: Config;
  pool: Pool;
  killbill: KillBillClient;
  mail: MailClient;
  storage: StorageClient;
  documents: DocumentsClient;
  health: ServiceHealth;
}

export async function createContext(): Promise<AppContext> {
  const config = loadConfig();
  const pool = new pg.Pool({ connectionString: config.databaseUrl });
  const killbill = new KillBillClient(config);
  const mail = new MailClient(config);
  const storage = new StorageClient(config);
  const documents = new DocumentsClient(config);
  const health = new ServiceHealth(killbill, mail, storage, documents);
  return { config, pool, killbill, mail, storage, documents, health };
}
