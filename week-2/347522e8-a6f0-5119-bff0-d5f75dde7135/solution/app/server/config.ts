// The one place the environment is read. Nothing here ever reaches the browser.

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

function positiveInteger(name: string, fallback?: number): number {
  const raw = process.env[name];
  const value = raw === undefined || raw === "" ? (fallback ?? Number.NaN) : Number(raw);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
}

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
  smtp: {
    host: required("SMTP_HOST"),
    port: positiveInteger("SMTP_PORT"),
    from: required("MAIL_FROM"),
  },
  s3: {
    endpoint: required("S3_ENDPOINT").replace(/\/+$/, ""),
    region: required("S3_REGION"),
    bucket: required("S3_BUCKET"),
    forcePathStyle: (process.env.S3_FORCE_PATH_STYLE ?? "true").toLowerCase() === "true",
    accessKeyId: required("S3_ACCESS_KEY_ID"),
    secretAccessKey: required("S3_SECRET_ACCESS_KEY"),
  },
  holdTtlSeconds: positiveInteger("HOLD_TTL_SECONDS", 600),
  complianceScanSeconds: positiveInteger("COMPLIANCE_SCAN_SECONDS", 60),
  outboxRetrySeconds: positiveInteger("OUTBOX_RETRY_SECONDS", 30),
} as const;
