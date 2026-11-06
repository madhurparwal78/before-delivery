import * as crypto from "node:crypto";

export interface Config {
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
  publicPort: number;
  pickupWindowSeconds: number;
  reminderLeadSeconds: number;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`Missing environment variable ${name}`);
  }
  return value;
}

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function loadConfig(): Config {
  return {
    databaseUrl: requireEnv("DATABASE_URL"),
    killbillUrl: requireEnv("KILLBILL_URL").replace(/\/+$/, ""),
    killbillUsername: requireEnv("KILLBILL_USERNAME"),
    killbillPassword: requireEnv("KILLBILL_PASSWORD"),
    killbillApiKey: requireEnv("KILLBILL_API_KEY"),
    killbillApiSecret: requireEnv("KILLBILL_API_SECRET"),
    s3Endpoint: requireEnv("S3_ENDPOINT").replace(/\/+$/, ""),
    s3Region: requireEnv("S3_REGION"),
    s3Bucket: requireEnv("S3_BUCKET"),
    s3ForcePathStyle: process.env.S3_FORCE_PATH_STYLE !== "false",
    s3AccessKeyId: requireEnv("S3_ACCESS_KEY_ID"),
    s3SecretAccessKey: requireEnv("S3_SECRET_ACCESS_KEY"),
    smtpHost: requireEnv("SMTP_HOST"),
    smtpPort: intEnv("SMTP_PORT", 25),
    mailFrom: requireEnv("MAIL_FROM"),
    publicPort: intEnv("APP_PUBLIC_PORT", 4173),
    pickupWindowSeconds: intEnv("SHEDLINE_PICKUP_WINDOW_SECONDS", 172800),
    reminderLeadSeconds: intEnv("SHEDLINE_REMINDER_LEAD_SECONDS", 86400),
  };
}

export function randomUuid(): string {
  return crypto.randomUUID();
}

export function randomToken(): string {
  return crypto.randomBytes(24).toString("base64url");
}
