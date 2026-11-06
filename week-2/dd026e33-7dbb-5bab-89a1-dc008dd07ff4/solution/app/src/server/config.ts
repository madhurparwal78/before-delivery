// The one configuration module (brief: Configuration and secrets). Every credential and service URL
// is read from the environment here; nothing in it is ever sent to the browser, logged or returned.

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") throw new Error(`${name} must be set`);
  return value;
}

function seconds(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  if (!/^\d+$/.test(raw.trim())) throw new Error(`${name} must be a whole number of seconds`);
  return Number(raw.trim());
}

const keyPrefix = (process.env.KILLBILL_KEY_PREFIX ?? "").trim();
const publicUrl = required("APP_PUBLIC_URL").replace(/\/+$/, "");

export const config = {
  port: Number(process.env.APP_PUBLIC_PORT?.trim() || "4173"),
  publicUrl,
  publicOrigin: new URL(publicUrl).origin,
  databaseUrl: required("DATABASE_URL"),
  s3: {
    endpoint: required("S3_ENDPOINT").replace(/\/+$/, ""),
    region: required("S3_REGION"),
    bucket: required("S3_BUCKET"),
    forcePathStyle: (process.env.S3_FORCE_PATH_STYLE ?? "").trim().toLowerCase() === "true",
    accessKeyId: required("S3_ACCESS_KEY_ID"),
    secretAccessKey: required("S3_SECRET_ACCESS_KEY"),
  },
  killbill: {
    url: required("KILLBILL_URL").replace(/\/+$/, ""),
    username: required("KILLBILL_USERNAME"),
    password: required("KILLBILL_PASSWORD"),
    apiKey: required("KILLBILL_API_KEY"),
    apiSecret: required("KILLBILL_API_SECRET"),
    keyPrefix: keyPrefix === "" ? "" : `${keyPrefix}-`,
  },
  mail: {
    host: required("SMTP_HOST"),
    port: Number(required("SMTP_PORT")),
    from: required("MAIL_FROM"),
  },
  timers: {
    sessionLifetimeSeconds: seconds("SESSION_LIFETIME_SECONDS", 43200),
    startupOverdueSeconds: seconds("STARTUP_OVERDUE_SECONDS", 2592000),
    estimateExpirySeconds: seconds("ESTIMATE_EXPIRY_SECONDS", 1209600),
  },
} as const;
