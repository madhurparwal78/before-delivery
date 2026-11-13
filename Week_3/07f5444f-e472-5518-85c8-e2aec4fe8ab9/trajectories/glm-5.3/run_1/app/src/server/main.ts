// Boot: environment, schema, seed, mail reminder sweep, the published port.

import { Pool } from "pg";
import express from "express";
import cookieParser from "cookie-parser";
import { buildApp, runReminderSweep, type AppState } from "./app.js";
import { applySchema } from "./schema.js";
import { seedIfEmpty } from "./seed.js";
import { MailService } from "./mail.js";
import type { StoreConfig } from "./store.js";

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}.`);
  return value;
}

const port = Number(process.env.APP_PUBLIC_PORT ?? "4173");
const reminderSweepSeconds = Math.min(
  60,
  Math.max(1, Number(process.env.REMINDER_SWEEP_SECONDS ?? "30"))
);

const store: StoreConfig = {
  endpoint: requiredEnv("S3_ENDPOINT"),
  region: process.env.S3_REGION ?? "us-east-1",
  bucket: requiredEnv("S3_BUCKET"),
  accessKeyId: requiredEnv("S3_ACCESS_KEY_ID"),
  secretAccessKey: requiredEnv("S3_SECRET_ACCESS_KEY"),
  forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
};

const mail = new MailService({
  host: requiredEnv("SMTP_HOST"),
  port: Number(process.env.SMTP_PORT ?? "1025"),
  from: process.env.MAIL_FROM ?? "library@quirewell.test",
});

const pool = new Pool({ connectionString: requiredEnv("DATABASE_URL") });
const state: AppState = { pool, store, mail };

let ready = false;

async function boot(): Promise<void> {
  for (;;) {
    try {
      await pool.query("SELECT 1");
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  await applySchema(pool);
  await seedIfEmpty(pool);
  await runReminderSweep(state);
  ready = true;
}

const app = express();
app.disable("x-powered-by");
app.use(cookieParser());

// The health check answers 200 once the schema is applied and Postgres answers.
app.get("/api/health", async (_req, res) => {
  if (!ready) {
    res.status(503).json({ status: "starting" });
    return;
  }
  try {
    await pool.query("SELECT 1");
    res.status(200).json({ status: "ok" });
  } catch {
    res.status(503).json({ status: "starting" });
  }
});

app.use(buildApp(state));

app.listen(port, "0.0.0.0", () => {
  void boot().catch((error) => {
    process.stderr.write(`boot failed: ${String(error)}\n`);
  });
});

setInterval(() => {
  if (ready) void runReminderSweep(state);
}, reminderSweepSeconds * 1000);

process.on("SIGTERM", () => {
  void pool.end().catch(() => undefined).finally(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
});
