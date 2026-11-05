export interface Config {
  port: number;
  dbPath: string;
  kbKeyPrefix: string;
  mailRetrySeconds: number;
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
  mailEndpoint: string;
}

function need(name: string): string {
  const v = process.env[name];
  if (v === undefined || v === "") throw new Error(`Missing required environment variable ${name}`);
  return v;
}

export function loadConfig(): Config {
  const smtpPort = parseInt(need("SMTP_PORT"), 10);
  const port = process.env.APP_PUBLIC_PORT ? parseInt(process.env.APP_PUBLIC_PORT, 10) : 4173;
  const retry = process.env.MAIL_RETRY_SECONDS ? parseInt(process.env.MAIL_RETRY_SECONDS, 10) : 30;
  return {
    port,
    dbPath: process.env.TALLY_DB_PATH ?? "data/tally.db",
    kbKeyPrefix: process.env.TALLY_KB_KEY_PREFIX ?? "tally",
    mailRetrySeconds: Math.min(300, Math.max(1, retry)),
    killbillUrl: need("KILLBILL_URL").replace(/\/+$/, ""),
    killbillUsername: need("KILLBILL_USERNAME"),
    killbillPassword: need("KILLBILL_PASSWORD"),
    killbillApiKey: need("KILLBILL_API_KEY"),
    killbillApiSecret: need("KILLBILL_API_SECRET"),
    smtpHost: need("SMTP_HOST"),
    smtpPort,
    mailFrom: process.env.MAIL_FROM ?? "Tare & Tally <pickup@tare-and-tally.example>",
    s3Endpoint: need("S3_ENDPOINT").replace(/\/+$/, ""),
    s3Region: process.env.S3_REGION ?? "us-east-1",
    s3Bucket: need("S3_BUCKET"),
    s3ForcePathStyle: (process.env.S3_FORCE_PATH_STYLE ?? "true") === "true",
    s3AccessKeyId: need("S3_ACCESS_KEY_ID"),
    s3SecretAccessKey: need("S3_SECRET_ACCESS_KEY"),
    mailEndpoint: `${need("SMTP_HOST")}:${smtpPort}`,
  };
}

export const PRODUCER_TIMEOUT_MS = 5000;
