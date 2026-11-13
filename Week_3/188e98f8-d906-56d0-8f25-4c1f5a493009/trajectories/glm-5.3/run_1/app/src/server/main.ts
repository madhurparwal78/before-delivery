import { applySchemaAndSeed } from "./seed";
import { poolStore, type DbStore } from "./db";
import { createDbPool } from "./pool";
import { SheetStorage, storageFromEnv } from "./storage";
import { NoteDelivery, poolNoteStore, type SmtpConfig } from "./mail";
import { parseRoundSeconds } from "./rate";
import { createServer } from "./routes";

export interface AppConfig {
  readonly port: number;
  readonly roundSeconds: number;
  readonly smtp: SmtpConfig;
}

export function appConfigFromEnv(): AppConfig {
  const portRaw = Number.parseInt(process.env["APP_PUBLIC_PORT"] ?? "", 10);
  return {
    port: Number.isFinite(portRaw) && portRaw > 0 ? portRaw : 4173,
    roundSeconds: parseRoundSeconds(process.env["ROUND_SECONDS"]),
    smtp: {
      host: process.env["SMTP_HOST"] ?? "",
      port: Number.parseInt(process.env["SMTP_PORT"] ?? "1025", 10),
      from: process.env["MAIL_FROM"] ?? "",
    },
  };
}

export async function startServer(): Promise<void> {
  const config = appConfigFromEnv();
  const pool = createDbPool(process.env["DATABASE_URL"] ?? "");
  const store = poolStore(pool.raw());
  const storage = new SheetStorage(storageFromEnv());
  const notes = new NoteDelivery(poolNoteStore(pool.raw()), config.smtp);
  let ready = false;
  const app = createServer({ store, storage, notes, roundSeconds: config.roundSeconds, isReady: () => ready });
  const boot = async (): Promise<void> => {
    await applySchemaAndSeed(store);
    try {
      await storage.ensureBucket();
    } catch {
      // Storage is unreachable at boot; the server starts anyway.
    }
    notes.start();
    ready = true;
  };
  const retry = (): void => {
    void boot().catch(() => {
      setTimeout(retry, 2_000);
    });
  };
  retry();

  app.listen(config.port, "0.0.0.0");
}

void startServer();
