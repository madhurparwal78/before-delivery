// The only module that reads the environment. Every service URL and credential comes from here.

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") throw new Error(`Environment variable ${name} is required`);
  return value.trim();
}

function optionalSeconds(name: string): number | null {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") return null;
  if (!/^\d+$/.test(value.trim())) throw new Error(`Environment variable ${name} must be whole seconds`);
  return parseInt(value.trim(), 10);
}

const DAY_MS = 86_400_000;

function lifetimeMs(name: string, fallbackMs: number): number {
  const seconds = optionalSeconds(name);
  return seconds === null ? fallbackMs : seconds * 1000;
}

export const config = {
  port: parseInt(process.env.APP_PUBLIC_PORT?.trim() || "4173", 10),
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
    forcePathStyle: required("S3_FORCE_PATH_STYLE").toLowerCase() === "true",
    accessKeyId: required("S3_ACCESS_KEY_ID"),
    secretAccessKey: required("S3_SECRET_ACCESS_KEY"),
  },
  smtp: {
    host: required("SMTP_HOST"),
    port: parseInt(required("SMTP_PORT"), 10),
    mailFrom: required("MAIL_FROM"),
  },
  clock: {
    // null means "12 calendar months", the brief's default for pack expiry.
    seatExpirySeconds: optionalSeconds("CREDWELL_SEAT_EXPIRY_SECONDS"),
    fullRefundWindowMs: lifetimeMs("CREDWELL_FULL_REFUND_WINDOW_SECONDS", 7 * DAY_MS),
    shareLinkTtlMs: lifetimeMs("CREDWELL_SHARE_LINK_TTL_SECONDS", 90 * DAY_MS),
    downloadLinkTtlMs: lifetimeMs("CREDWELL_DOWNLOAD_LINK_TTL_SECONDS", 7 * DAY_MS),
    sealRetryMs: lifetimeMs("CREDWELL_SEAL_RETRY_SECONDS", 15_000),
  },
} as const;
