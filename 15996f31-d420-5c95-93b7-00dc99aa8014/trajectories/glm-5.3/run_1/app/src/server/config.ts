export type Role = "broker" | "beekeeper" | "grower";

export interface Config {
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
  appPublicPort: number;
  appBaseUrl: string;
  inspectionLinkTtlSeconds: number;
  fileUrlTtlSeconds: number;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

function integer(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`Environment variable ${name} must be a non-negative integer`);
  }
  return parsed;
}

export function loadConfig(): Config {
  return {
    databaseUrl: required("DATABASE_URL"),
    killbillUrl: required("KILLBILL_URL"),
    killbillUsername: required("KILLBILL_USERNAME"),
    killbillPassword: required("KILLBILL_PASSWORD"),
    killbillApiKey: required("KILLBILL_API_KEY"),
    killbillApiSecret: required("KILLBILL_API_SECRET"),
    smtpHost: required("SMTP_HOST"),
    smtpPort: integer("SMTP_PORT", 1025),
    mailFrom: required("MAIL_FROM"),
    s3Endpoint: required("S3_ENDPOINT"),
    s3Region: required("S3_REGION"),
    s3Bucket: required("S3_BUCKET"),
    s3ForcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
    s3AccessKeyId: required("S3_ACCESS_KEY_ID"),
    s3SecretAccessKey: required("S3_SECRET_ACCESS_KEY"),
    appPublicPort: integer("APP_PUBLIC_PORT", 4173),
    appBaseUrl: process.env.APP_BASE_URL?.replace(/\/$/, "") ?? "http://localhost:4173",
    inspectionLinkTtlSeconds: integer("INSPECTION_LINK_TTL_SECONDS", 259200),
    fileUrlTtlSeconds: integer("FILE_URL_TTL_SECONDS", 300),
  };
}
