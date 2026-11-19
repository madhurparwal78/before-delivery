// Every service URL and credential is read from the environment at start and
// is never hard-coded, logged, or sent to the browser.

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
  gotenbergUrl: string;
  appPublicPort: number;
  appPublicUrl: string;
  minCampaignSeconds: number;
  finalWindowSeconds: number;
  fixWindowSeconds: number;
  fixNoticeSeconds: number;
  jsonBodyLimit: number;
  imageBodyLimit: number;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`Missing environment variable ${name}`);
  }
  return value;
}

function optionalInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function loadConfig(): Config {
  return {
    databaseUrl: requireEnv("DATABASE_URL"),
    killbillUrl: requireEnv("KILLBILL_URL").replace(/\/$/, ""),
    killbillUsername: requireEnv("KILLBILL_USERNAME"),
    killbillPassword: requireEnv("KILLBILL_PASSWORD"),
    killbillApiKey: requireEnv("KILLBILL_API_KEY"),
    killbillApiSecret: requireEnv("KILLBILL_API_SECRET"),
    smtpHost: requireEnv("SMTP_HOST"),
    smtpPort: optionalInt("SMTP_PORT", 25),
    mailFrom: requireEnv("MAIL_FROM"),
    s3Endpoint: requireEnv("S3_ENDPOINT").replace(/\/$/, ""),
    s3Region: requireEnv("S3_REGION"),
    s3Bucket: requireEnv("S3_BUCKET"),
    s3ForcePathStyle: process.env.S3_FORCE_PATH_STYLE !== "false",
    s3AccessKeyId: requireEnv("S3_ACCESS_KEY_ID"),
    s3SecretAccessKey: requireEnv("S3_SECRET_ACCESS_KEY"),
    gotenbergUrl: requireEnv("GOTENBERG_URL").replace(/\/$/, ""),
    appPublicPort: optionalInt("APP_PUBLIC_PORT", 4173),
    appPublicUrl: requireEnv("APP_PUBLIC_URL").replace(/\/$/, ""),
    minCampaignSeconds: optionalInt("MIN_CAMPAIGN_SECONDS", 86400),
    finalWindowSeconds: optionalInt("FINAL_WINDOW_SECONDS", 86400),
    fixWindowSeconds: optionalInt("FIX_WINDOW_SECONDS", 604800),
    fixNoticeSeconds: optionalInt("FIX_NOTICE_SECONDS", 172800),
    jsonBodyLimit: 65536,
    imageBodyLimit: 5000000,
  };
}
