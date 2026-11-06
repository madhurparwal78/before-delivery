import { randomBytes } from "node:crypto";

export interface Config {
  databaseUrl: string;
  s3: {
    endpoint: string;
    region: string;
    bucket: string;
    forcePathStyle: boolean;
    accessKeyId: string;
    secretAccessKey: string;
  };
  smtp: { host: string; port: number };
  mailFrom: string;
  appPublicUrl: string;
  port: number;
  magicLinkTtlSeconds: number;
  reviewerLinkHourSeconds: number;
  checkpointUploadDeadlineSeconds: number;
  importPlanTtlSeconds: number;
}

function intEnv(name: string, fallback: number): number {
  const v = process.env[name];
  if (v === undefined || v === "") return fallback;
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`${name} must be a positive integer`);
  return n;
}

export function loadConfig(): Config {
  const port = intEnv("APP_PUBLIC_PORT", 4173);
  const s3Endpoint = requireEnv("S3_ENDPOINT");
  return {
    databaseUrl: requireEnv("DATABASE_URL"),
    s3: {
      endpoint: s3Endpoint,
      region: requireEnv("S3_REGION"),
      bucket: requireEnv("S3_BUCKET"),
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
      accessKeyId: requireEnv("S3_ACCESS_KEY_ID"),
      secretAccessKey: requireEnv("S3_SECRET_ACCESS_KEY"),
    },
    smtp: { host: requireEnv("SMTP_HOST"), port: intEnv("SMTP_PORT", 1025) },
    mailFrom: requireEnv("MAIL_FROM"),
    appPublicUrl: process.env.APP_PUBLIC_URL || `http://localhost:${port}`,
    port,
    magicLinkTtlSeconds: intEnv("MAGIC_LINK_TTL_SECONDS", 900),
    reviewerLinkHourSeconds: intEnv("REVIEWER_LINK_HOUR_SECONDS", 3600),
    checkpointUploadDeadlineSeconds: intEnv("CHECKPOINT_UPLOAD_DEADLINE_SECONDS", 86400),
    importPlanTtlSeconds: intEnv("IMPORT_PLAN_TTL_SECONDS", 3600),
  };
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (v === undefined || v === "") throw new Error(`Missing environment variable ${name}`);
  return v;
}

export function randomToken(): string {
  return randomBytes(32).toString("base64url");
}

export function newId(): string {
  return randomBytes(16).toString("hex") + "-" + Date.now().toString(36);
}
