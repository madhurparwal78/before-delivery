import { readEnvInt } from "./env.js";

export interface AppConfig {
  port: number;
  publicUrl: string | null;
  databaseUrl: string;
  killbillUrl: string;
  killbillUsername: string;
  killbillPassword: string;
  killbillApiKey: string;
  killbillApiSecret: string;
  smtpHost: string;
  smtpPort: number;
  mailFrom: string;
  s3Endpoint: string;
  s3Region: string;
  s3Bucket: string;
  s3ForcePathStyle: boolean;
  s3AccessKeyId: string;
  s3SecretAccessKey: string;
  reservationHoldSeconds: number;
  signingLinkTtlSeconds: number;
  clockStart: string | null;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value;
}

export function loadConfig(): AppConfig {
  return {
    port: readEnvInt("APP_PUBLIC_PORT", 4173),
    publicUrl: process.env.APP_PUBLIC_URL ?? null,
    databaseUrl: required("DATABASE_URL"),
    killbillUrl: process.env.KILLBILL_URL ?? "",
    killbillUsername: process.env.KILLBILL_USERNAME ?? "",
    killbillPassword: process.env.KILLBILL_PASSWORD ?? "",
    killbillApiKey: process.env.KILLBILL_API_KEY ?? "",
    killbillApiSecret: process.env.KILLBILL_API_SECRET ?? "",
    smtpHost: process.env.SMTP_HOST ?? "",
    smtpPort: readEnvInt("SMTP_PORT", 1025),
    mailFrom: process.env.MAIL_FROM ?? "",
    s3Endpoint: process.env.S3_ENDPOINT ?? "",
    s3Region: process.env.S3_REGION ?? "us-east-1",
    s3Bucket: process.env.S3_BUCKET ?? "",
    s3ForcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
    s3AccessKeyId: process.env.S3_ACCESS_KEY_ID ?? "",
    s3SecretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "",
    reservationHoldSeconds: readEnvInt("RESERVATION_HOLD_SECONDS", 172800),
    signingLinkTtlSeconds: readEnvInt("SIGNING_LINK_TTL_SECONDS", 86400),
    clockStart: process.env.BELLROLL_CLOCK_START ?? null,
  };
}
