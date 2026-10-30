/**
 * Configuration (DP-44). Every credential and URL is read from the
 * environment, never hard-coded and never sent to the browser.
 */

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
  smtp: {
    host: string;
    port: number;
  };
  mailFrom: string;
  port: number;
  baseUrl: string;
  attachmentRetrySeconds: number;
  outboxRetrySeconds: number;
  inviteTtlSeconds: number;
  sessionIdleSeconds: number;
}

function intEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number.parseInt(raw, 10);
  if (Number.isNaN(value)) return fallback;
  return Math.min(Math.max(value, min), max);
}

const MAIL_FROM_DEFAULT = "Loomwise Evidence Desk <updates@loomwise.example>";

export function loadConfig(): Config {
  const port = intEnv("APP_PUBLIC_PORT", 4173, 1, 65535);
  const baseUrlEnv = process.env.APP_BASE_URL ?? process.env.APP_PUBLIC_URL;
  const baseUrl = baseUrlEnv && baseUrlEnv.trim() !== "" ? baseUrlEnv : `http://localhost:${port}`;
  return {
    databaseUrl: process.env.DATABASE_URL ?? "",
    s3: {
      endpoint: process.env.S3_ENDPOINT ?? "",
      region: process.env.S3_REGION ?? "us-east-1",
      bucket: process.env.S3_BUCKET ?? "",
      forcePathStyle: (process.env.S3_FORCE_PATH_STYLE ?? "").toLowerCase() === "true",
      accessKeyId: process.env.S3_ACCESS_KEY_ID ?? "",
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "",
    },
    smtp: {
      host: process.env.SMTP_HOST ?? "",
      port: intEnv("SMTP_PORT", 1025, 1, 65535),
    },
    mailFrom: process.env.MAIL_FROM ?? MAIL_FROM_DEFAULT,
    port,
    baseUrl: baseUrl.replace(/\/$/, ""),
    attachmentRetrySeconds: intEnv("ATTACHMENT_RETRY_SECONDS", 10, 1, 60),
    outboxRetrySeconds: intEnv("OUTBOX_RETRY_SECONDS", 10, 1, 60),
    inviteTtlSeconds: intEnv("INVITE_TTL_SECONDS", 604800, 1, 31_536_000),
    sessionIdleSeconds: intEnv("SESSION_IDLE_SECONDS", 43200, 60, 31_536_000),
  };
}
