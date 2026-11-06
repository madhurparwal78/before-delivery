// The one configuration module: every service URL, credential and timing value comes from the
// environment variables the brief names, read once at start.
import { randomBytes } from "node:crypto";
import { linkSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") throw new Error(`${name} is not set`);
  return value;
}

function seconds(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive number of seconds`);
  return value;
}

// The sealing key lives in FARSHORE_SECRET_KEY or, when that is unset, in the one server-local file the
// brief allows: under the working directory, created once with owner-only permissions, never served.
const SEALING_KEY_FILE = ".farshore-sealing-key";

function sealingKey(): string {
  const fromEnv = process.env.FARSHORE_SECRET_KEY;
  if (fromEnv) return fromEnv;
  const path = join(process.cwd(), SEALING_KEY_FILE);
  try {
    return readFileSync(path, "utf8").trim();
  } catch {
    const draft = `${path}.${process.pid}.${randomBytes(4).toString("hex")}`;
    writeFileSync(draft, randomBytes(32).toString("base64url"), { mode: 0o600 });
    try {
      linkSync(draft, path);
    } catch {
      // Another process created the file first; its key wins.
    }
    unlinkSync(draft);
    return readFileSync(path, "utf8").trim();
  }
}

export const config = {
  port: Number(process.env.APP_PUBLIC_PORT || 4173),
  databaseUrl: required("DATABASE_URL"),
  s3: {
    endpoint: required("S3_ENDPOINT").replace(/\/+$/, ""),
    region: required("S3_REGION"),
    bucket: required("S3_BUCKET"),
    forcePathStyle: (process.env.S3_FORCE_PATH_STYLE ?? "true") !== "false",
    accessKeyId: required("S3_ACCESS_KEY_ID"),
    secretAccessKey: required("S3_SECRET_ACCESS_KEY"),
  },
  killbill: {
    url: required("KILLBILL_URL").replace(/\/+$/, ""),
    username: required("KILLBILL_USERNAME"),
    password: required("KILLBILL_PASSWORD"),
    apiKey: required("KILLBILL_API_KEY"),
    apiSecret: required("KILLBILL_API_SECRET"),
  },
  smtp: {
    host: required("SMTP_HOST"),
    port: Number(required("SMTP_PORT")),
    from: required("MAIL_FROM"),
  },
  secretKey: sealingKey(),
  inviteTtlSeconds: seconds("FARSHORE_INVITE_TTL_SECONDS", 259_200),
  signinWindowSeconds: seconds("FARSHORE_SIGNIN_WINDOW_SECONDS", 900),
  billingSyncSeconds: seconds("FARSHORE_BILLING_SYNC_SECONDS", 60),
  idempotencyTtlSeconds: seconds("FARSHORE_IDEMPOTENCY_TTL_SECONDS", 86_400),
  daySeconds: seconds("FARSHORE_DAY_SECONDS", 86_400),
  lifecycleSweepSeconds: seconds("FARSHORE_LIFECYCLE_SWEEP_SECONDS", 60),
  webhookBackoffSeconds: seconds("FARSHORE_WEBHOOK_BACKOFF_SECONDS", 10),
  undoSeconds: seconds("FARSHORE_UNDO_SECONDS", 30),
  twoStepPendingSeconds: seconds("FARSHORE_TWO_STEP_PENDING_SECONDS", 300),
  stepUpSeconds: seconds("FARSHORE_STEP_UP_SECONDS", 300),
  sessionIdleSeconds: seconds("FARSHORE_SESSION_IDLE_SECONDS", 1_800),
  sessionLifetimeSeconds: seconds("FARSHORE_SESSION_LIFETIME_SECONDS", 43_200),
  keyRotationOverlapSeconds: seconds("FARSHORE_KEY_ROTATION_OVERLAP_SECONDS", 86_400),
};
