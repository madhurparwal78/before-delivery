import express from "express";
import type { AppConfig } from "./config.js";
import type { Clock } from "./clock.js";
import type { Storage } from "./storage.js";
import type { Sql } from "./db.js";
import { SCHEMA } from "./db.js";
import { Billing } from "./billing.js";
import { Mailer } from "./mail.js";
import { createSql } from "./db.js";
import { loadConfig } from "./config.js";
import { createStorage, ensureBucket } from "./storage.js";
import { Clock as ClockClass } from "./clock.js";
import { applySeed } from "./seed.js";
import { tick } from "./domain/scheduler.js";
import { registerRoutes } from "./routes.js";
import { registerStatic } from "./static.js";
import type { Services } from "./services.js";

export class App {
  readonly config: AppConfig;
  readonly sql: Sql;
  readonly storage: Storage;
  readonly billing: Billing;
  readonly mailer: Mailer;
  readonly clock: Clock;
  readonly express: express.Express;
  private schedulerTimer: NodeJS.Timeout | null = null;

  constructor(config: AppConfig, services: Services) {
    this.config = config;
    this.sql = services.sql;
    this.storage = services.storage;
    this.billing = services.billing;
    this.mailer = services.mailer;
    this.clock = services.clock;
    this.express = express();
    registerRoutes(this.express, services, config);
    registerStatic(this.express);
  }

  listen(): void {
    this.express.listen(this.config.port, "0.0.0.0");
  }

  startScheduler(): void {
    let ticking = false;
    const run = async (): Promise<void> => {
      if (ticking) return;
      ticking = true;
      try {
        await this.clock.refresh(this.sql);
        await tick({ sql: this.sql, storage: this.storage, billing: this.billing, mailer: this.mailer, clock: this.clock });
      } catch {
        // Providers may be down; the next tick retries.
      }
      ticking = false;
    };
    this.schedulerTimer = setInterval(run, 2000);
  }

  stopScheduler(): void {
    if (this.schedulerTimer) clearInterval(this.schedulerTimer);
  }
}

export async function boot(): Promise<App> {
  const config = loadConfig();
  const sql = createSql(config);
  const storage = createStorage(config);
  const billing = new Billing(config);
  const mailer = new Mailer(config);

  // If Postgres, MinIO, Kill Bill or Mailpit is unreachable at start, the app
  // still starts, binds its port and answers the health check.
  let clock: ClockClass;
  let storageUp = false;
  try {
    await sql`SELECT 1`;
    await sql.unsafe(SCHEMA);
    storageUp = await storageReachable(storage);
    if (storageUp) {
      try {
        await ensureBucket(storage);
      } catch {
        storageUp = false;
      }
    }
    await applySeed(sql, storageUp ? storage : null);
    clock = await ClockClass.load(sql);
  } catch {
    clock = ClockClass.fallback();
  }

  const app = new App(config, { sql, storage, billing, mailer, clock });
  app.listen();
  app.startScheduler();
  return app;
}

async function storageReachable(storage: Storage): Promise<boolean> {
  try {
    await storage.client.listBuckets();
    return true;
  } catch {
    return false;
  }
}


