import * as crypto from "node:crypto";

const limits = {
  VERIFY_LINK_SECONDS: 86400,
  SIGNIN_MAX_FAILURES: 5,
  SIGNIN_LOCK_SECONDS: 900,
  INVITE_COOLDOWN_SECONDS: 60,
  PRESENCE_IDLE_SECONDS: 120,
  UPLOAD_MAX_BYTES: 5000000,
  TRIAL_DAYS: 30,
} as const;

export type LimitKey = keyof typeof limits;

function int(value: string | undefined, fallback: number): number {
  const n = Number.parseInt(value ?? "", 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

const intLimits: Record<LimitKey, number> = {
  VERIFY_LINK_SECONDS: int(process.env.VERIFY_LINK_SECONDS, limits.VERIFY_LINK_SECONDS),
  SIGNIN_MAX_FAILURES: int(process.env.SIGNIN_MAX_FAILURES, limits.SIGNIN_MAX_FAILURES),
  SIGNIN_LOCK_SECONDS: int(process.env.SIGNIN_LOCK_SECONDS, limits.SIGNIN_LOCK_SECONDS),
  INVITE_COOLDOWN_SECONDS: int(process.env.INVITE_COOLDOWN_SECONDS, limits.INVITE_COOLDOWN_SECONDS),
  PRESENCE_IDLE_SECONDS: int(process.env.PRESENCE_IDLE_SECONDS, limits.PRESENCE_IDLE_SECONDS),
  UPLOAD_MAX_BYTES: int(process.env.UPLOAD_MAX_BYTES, limits.UPLOAD_MAX_BYTES),
  TRIAL_DAYS: int(process.env.TRIAL_DAYS, limits.TRIAL_DAYS),
};

export const studioZones = [
  "UTC",
  "America/New_York",
  "America/Chicago",
  "America/Los_Angeles",
  "Europe/London",
  "Europe/Berlin",
  "Asia/Kolkata",
  "Asia/Tokyo",
  "Australia/Sydney",
] as const;

export type StudioZone = (typeof studioZones)[number];

export function isStudioZone(value: string): value is StudioZone {
  return (studioZones as readonly string[]).includes(value);
}

const port = process.env.APP_PUBLIC_PORT ? int(process.env.APP_PUBLIC_PORT, 4173) : 4173;

export const config = {
  port,
  publicUrl: (process.env.APP_PUBLIC_URL || `http://localhost:${port}`).replace(/\/$/, ""),
  databaseUrl: process.env.DATABASE_URL || "",
  valkeyUrl: process.env.VALKEY_URL || "",
  smtpHost: process.env.SMTP_HOST || "",
  smtpPort: int(process.env.SMTP_PORT, 1025),
  mailFrom: process.env.MAIL_FROM || "Corbel Draft <no-reply@corbelworks.example>",
  s3: {
    endpoint: process.env.S3_ENDPOINT || "",
    region: process.env.S3_REGION || "us-east-1",
    bucket: process.env.S3_BUCKET || "",
    forcePathStyle: (process.env.S3_FORCE_PATH_STYLE || "true").toLowerCase() === "true",
    accessKeyId: process.env.S3_ACCESS_KEY_ID || "",
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || "",
  },
  grading: (process.env.CORBEL_GRADING || "on").toLowerCase() !== "off",
  limits: intLimits,
  bodyLimitBytes: 1_000_000,
} as const;

export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString("base64url");
}

export function randomPassword(): string {
  return crypto.randomBytes(12).toString("base64url");
}
