// The one place that reads the environment. Values are read once at start.

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") throw new Error(`${name} is not set`);
  return value;
}

function seconds(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a whole number of seconds`);
  return value;
}

export const config = {
  port: Number(process.env.APP_PUBLIC_PORT || 4173),
  publicUrl: required("APP_PUBLIC_URL").replace(/\/+$/, ""),
  databaseUrl: required("DATABASE_URL"),
  s3: {
    endpoint: required("S3_ENDPOINT").replace(/\/+$/, ""),
    region: required("S3_REGION"),
    bucket: required("S3_BUCKET"),
    forcePathStyle: (process.env.S3_FORCE_PATH_STYLE ?? "true").toLowerCase() !== "false",
    accessKeyId: required("S3_ACCESS_KEY_ID"),
    secretAccessKey: required("S3_SECRET_ACCESS_KEY"),
  },
  killbill: {
    url: required("KILLBILL_URL").replace(/\/+$/, ""),
    username: required("KILLBILL_USERNAME"),
    password: required("KILLBILL_PASSWORD"),
    apiKey: required("KILLBILL_API_KEY"),
    apiSecret: required("KILLBILL_API_SECRET"),
  },
  smtp: {
    host: required("SMTP_HOST"),
    port: Number(required("SMTP_PORT")),
    from: process.env.MAIL_FROM || "Tidewright <bookings@tidewright.example>",
  },
  timers: {
    holdSeconds: seconds("HOLD_SECONDS", 172800),
    brokerPageSeconds: seconds("BROKER_PAGE_SECONDS", 1209600),
    manifestPageSeconds: seconds("MANIFEST_PAGE_SECONDS", 604800),
    manifestRetentionSeconds: seconds("MANIFEST_RETENTION_SECONDS", 2592000),
    sessionSeconds: seconds("SESSION_SECONDS", 28800),
    brokerRateWindowSeconds: seconds("BROKER_RATE_WINDOW_SECONDS", 600),
  },
} as const;
