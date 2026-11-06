import { randomUUID } from "node:crypto";

export type Config = {
  port: number;
  databaseUrl: string;
  killbillUrl: string;
  killbillUsername: string;
  killbillPassword: string;
  killbillApiKey: string;
  killbillApiSecret: string;
  s3Endpoint: string;
  s3Region: string;
  s3Bucket: string;
  s3ForcePathStyle: boolean;
  s3AccessKeyId: string;
  s3SecretAccessKey: string;
  smtpHost: string;
  smtpPort: number;
  mailFrom: string;
  appClockStart: string | undefined;
  sessionTtlSeconds: number;
  inviteTtlSeconds: number;
  signinLockSeconds: number;
  billingRetrySeconds: number;
  reminderSweepSeconds: number;
};

function envInt(name: string, def: number, min: number, max: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return def;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < min || n > max) return def;
  return Math.floor(n);
}

function envStr(name: string, def: string): string {
  const raw = process.env[name];
  return raw === undefined || raw === "" ? def : raw;
}

export const config: Config = loadConfig();

export function loadConfig(): Config {
  const portRaw = process.env.APP_PUBLIC_PORT;
  const port = portRaw !== undefined && portRaw !== "" && Number.isFinite(Number(portRaw)) ? Number(portRaw) : 4173;
  return {
    port,
    databaseUrl: envStr("DATABASE_URL", "postgresql://localhost/kiln_desk"),
    killbillUrl: envStr("KILLBILL_URL", "http://127.0.0.1:8080").replace(/\/+$/, ""),
    killbillUsername: envStr("KILLBILL_USERNAME", "admin"),
    killbillPassword: envStr("KILLBILL_PASSWORD", "password"),
    killbillApiKey: envStr("KILLBILL_API_KEY", "kiln-desk"),
    killbillApiSecret: envStr("KILLBILL_API_SECRET", "kiln-desk-secret"),
    s3Endpoint: envStr("S3_ENDPOINT", "http://127.0.0.1:9000").replace(/\/+$/, ""),
    s3Region: envStr("S3_REGION", "us-east-1"),
    s3Bucket: envStr("S3_BUCKET", "kiln-desk"),
    s3ForcePathStyle: process.env.S3_FORCE_PATH_STYLE !== "false",
    s3AccessKeyId: envStr("S3_ACCESS_KEY_ID", ""),
    s3SecretAccessKey: envStr("S3_SECRET_ACCESS_KEY", ""),
    smtpHost: envStr("SMTP_HOST", "127.0.0.1"),
    smtpPort: envInt("SMTP_PORT", 1025, 1, 65535),
    mailFrom: envStr("MAIL_FROM", "Kiln Desk <desk@kilndesk.example>"),
    appClockStart: process.env.APP_CLOCK_START || undefined,
    sessionTtlSeconds: envInt("SESSION_TTL_SECONDS", 43200, 60, 315360000),
    inviteTtlSeconds: envInt("INVITE_TTL_SECONDS", 604800, 60, 315360000),
    signinLockSeconds: envInt("SIGNIN_LOCK_SECONDS", 900, 1, 315360000),
    billingRetrySeconds: envInt("BILLING_RETRY_SECONDS", 15, 1, 60),
    reminderSweepSeconds: envInt("REMINDER_SWEEP_SECONDS", 60, 1, 60),
  };
}

export function newId(): string {
  return randomUUID();
}
