// The one place environment variables are read (brief: Configuration and secrets). Nothing here reaches the browser.
import { toIso } from "../shared/dates.ts";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

function text(name: string, fallback: string): string {
  return process.env[name] || fallback;
}

function integer(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) throw new Error(`${name} must be a non-negative integer`);
  return value;
}

const port = integer("APP_PUBLIC_PORT", 4173);

export const config = {
  port,
  publicUrl: text("APP_PUBLIC_URL", `http://127.0.0.1:${port}`),
  databaseUrl: required("DATABASE_URL"),
  s3: {
    endpoint: required("S3_ENDPOINT").replace(/\/+$/, ""),
    region: required("S3_REGION"),
    bucket: required("S3_BUCKET"),
    forcePathStyle: text("S3_FORCE_PATH_STYLE", "true") === "true",
    accessKeyId: required("S3_ACCESS_KEY_ID"),
    secretAccessKey: required("S3_SECRET_ACCESS_KEY"),
  },
  smtp: { host: required("SMTP_HOST"), port: integer("SMTP_PORT", 1025) },
  mailFrom: required("MAIL_FROM"),
  /** An empty key never matches, so the grading routes answer not found (brief: Grading routes). */
  gradingKey: process.env.GRADING_KEY ?? "",
  appStartAt: toIso(Date.parse(text("APP_START_AT", "2026-03-02T09:00:00+01:00"))),
  timeZone: text("APP_TIME_ZONE", "Europe/Berlin"),
  downloadLinkTtlSeconds: integer("DOWNLOAD_LINK_TTL_SECONDS", 300),
  deadlineHours: {
    standard: integer("DEADLINE_HOURS_STANDARD", 24),
    extended: integer("DEADLINE_HOURS_EXTENDED", 48),
    legal: integer("DEADLINE_HOURS_LEGAL", 72),
  },
  deadlineWarningPercent: integer("DEADLINE_WARNING_PERCENT", 75),
  expiryCeilingMultiplier: integer("EXPIRY_CEILING_MULTIPLIER", 2),
  proofMaxBytes: integer("PROOF_MAX_BYTES", 5_242_880),
  weightAnnounceDelayMs: integer("WEIGHT_ANNOUNCE_DELAY_MS", 300),
  submitDedupSeconds: integer("SUBMIT_DEDUP_SECONDS", 10),
  inviteTtlHours: integer("INVITE_TTL_HOURS", 72),
  sessionCookieName: text("SESSION_COOKIE_NAME", "rulehouse_session"),
  /** When unset a random secret is made at boot, so issued links die on restart. */
  linkSigningSecret: process.env.LINK_SIGNING_SECRET || crypto.randomUUID() + crypto.randomUUID(),
} as const;
