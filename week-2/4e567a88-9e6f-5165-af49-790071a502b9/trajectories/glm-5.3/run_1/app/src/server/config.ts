import { readEnvInt } from "./env.js";

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
  killbill: {
    url: string;
    username: string;
    password: string;
    apiKey: string;
    apiSecret: string;
  };
  smtp: { host: string; port: number; from: string };
  publicPort: number;
  publicUrl: string;
  jobRunSeconds: number;
  leaseSeconds: number;
  retentionDaySeconds: number;
  webhookRetryBaseSeconds: number;
  outboundAllowedHosts: string[];
}

function str(name: string, fallback = ""): string {
  const v = process.env[name];
  if (v === undefined || v === "") return fallback;
  return v;
}

export function loadConfig(): Config {
  return {
    databaseUrl: str("DATABASE_URL"),
    s3: {
      endpoint: str("S3_ENDPOINT"),
      region: str("S3_REGION", "us-east-1"),
      bucket: str("S3_BUCKET"),
      forcePathStyle: str("S3_FORCE_PATH_STYLE") === "true",
      accessKeyId: str("S3_ACCESS_KEY_ID"),
      secretAccessKey: str("S3_SECRET_ACCESS_KEY"),
    },
    killbill: {
      url: str("KILLBILL_URL").replace(/\/+$/, ""),
      username: str("KILLBILL_USERNAME"),
      password: str("KILLBILL_PASSWORD"),
      apiKey: str("KILLBILL_API_KEY"),
      apiSecret: str("KILLBILL_API_SECRET"),
    },
    smtp: {
      host: str("SMTP_HOST"),
      port: readEnvInt("SMTP_PORT", 1025),
      from: str("MAIL_FROM", "Lumenfold Dispatch <dispatch@lumenfold.example>"),
    },
    publicPort: readEnvInt("APP_PUBLIC_PORT", 4173),
    publicUrl: str("APP_PUBLIC_URL", `http://127.0.0.1:${readEnvInt("APP_PUBLIC_PORT", 4173)}`),
    jobRunSeconds: readEnvInt("JOB_RUN_SECONDS", 8),
    leaseSeconds: readEnvInt("LEASE_SECONDS", 30),
    retentionDaySeconds: readEnvInt("RETENTION_DAY_SECONDS", 86400),
    webhookRetryBaseSeconds: readEnvInt("WEBHOOK_RETRY_BASE_SECONDS", 2),
    outboundAllowedHosts: str("OUTBOUND_ALLOWED_HOSTS")
      .split(",")
      .map((h) => h.trim().toLowerCase())
      .filter((h) => h.length > 0),
  };
}
