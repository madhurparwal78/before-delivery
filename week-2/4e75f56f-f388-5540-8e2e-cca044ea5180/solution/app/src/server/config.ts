// The one place the server reads its environment. Service URLs and credentials have no
// fallbacks; non-secret settings (port, S3 region and path style, SMTP port, the brief's From
// line, hold and offer lengths) fall back to their documented defaults.

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

function seconds(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
}

function benchDaysNow(): Date | null {
  const raw = process.env.BENCH_DAYS_NOW;
  if (!raw) return null;
  const instant = new Date(raw);
  if (!/^\d{4}-\d{2}-\d{2}T/.test(raw) || Number.isNaN(instant.getTime())) {
    throw new Error("BENCH_DAYS_NOW must be an ISO 8601 UTC instant");
  }
  return instant;
}

export const config = {
  port: seconds("APP_PUBLIC_PORT", 4173),
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
    region: process.env.S3_REGION || "us-east-1",
    bucket: required("S3_BUCKET"),
    forcePathStyle: (process.env.S3_FORCE_PATH_STYLE || "true").toLowerCase() !== "false",
    accessKeyId: required("S3_ACCESS_KEY_ID"),
    secretAccessKey: required("S3_SECRET_ACCESS_KEY"),
  },
  smtp: {
    host: required("SMTP_HOST"),
    port: seconds("SMTP_PORT", 25),
    from: process.env.MAIL_FROM || "Opaline Bench Days <registrar@opaline-institute.test>",
  },
  pocketbase: {
    url: required("POCKETBASE_URL").replace(/\/+$/, ""),
    email: required("POCKETBASE_ADMIN_EMAIL"),
    password: required("POCKETBASE_ADMIN_PASSWORD"),
  },
  holdSeconds: seconds("HOLD_SECONDS", 480),
  offerSeconds: seconds("OFFER_SECONDS", 86400),
  benchDaysNow: benchDaysNow(),
} as const;
