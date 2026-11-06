import { randomBytes } from "node:crypto";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

function positiveInteger(name: string, fallback?: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") {
    if (fallback === undefined) throw new Error(`Missing required environment variable ${name}`);
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive whole number`);
  return value;
}

/** Every setting the server reads, all from the environment (brief: Configuration and secrets). */
export const config = {
  port: positiveInteger("APP_PUBLIC_PORT", 4173),
  databaseUrl: required("DATABASE_URL"),
  killbill: {
    url: required("KILLBILL_URL").replace(/\/+$/, ""),
    username: required("KILLBILL_USERNAME"),
    password: required("KILLBILL_PASSWORD"),
    apiKey: required("KILLBILL_API_KEY"),
    apiSecret: required("KILLBILL_API_SECRET"),
  },
  s3: {
    endpoint: required("S3_ENDPOINT").replace(/\/+$/, ""),
    region: required("S3_REGION"),
    bucket: required("S3_BUCKET"),
    forcePathStyle: required("S3_FORCE_PATH_STYLE") === "true",
    accessKeyId: required("S3_ACCESS_KEY_ID"),
    secretAccessKey: required("S3_SECRET_ACCESS_KEY"),
  },
  mail: {
    host: required("SMTP_HOST"),
    port: positiveInteger("SMTP_PORT"),
    from: required("MAIL_FROM"),
  },
  holdTtlSeconds: positiveInteger("HOLD_TTL_SECONDS", 600),
  binderLinkTtlSeconds: positiveInteger("BINDER_LINK_TTL_SECONDS", 604800),
  /** Signs the hs_session cookie: SESSION_SECRET when supplied, otherwise random for this process. */
  sessionSecret: process.env.SESSION_SECRET ? Buffer.from(process.env.SESSION_SECRET, "utf8") : randomBytes(32),
} as const;
