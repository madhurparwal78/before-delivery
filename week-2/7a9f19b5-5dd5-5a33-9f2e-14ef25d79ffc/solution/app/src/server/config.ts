// The one place the environment is read. Values are never logged or sent to the browser.

const REQUIRED = [
  "DATABASE_URL",
  "KILLBILL_URL",
  "KILLBILL_USERNAME",
  "KILLBILL_PASSWORD",
  "KILLBILL_API_KEY",
  "KILLBILL_API_SECRET",
  "SMTP_HOST",
  "SMTP_PORT",
  "MAIL_FROM",
  "S3_ENDPOINT",
  "S3_REGION",
  "S3_BUCKET",
  "S3_ACCESS_KEY_ID",
  "S3_SECRET_ACCESS_KEY",
  "POCKETBASE_URL",
  "POCKETBASE_ADMIN_EMAIL",
  "POCKETBASE_ADMIN_PASSWORD",
  "APP_PUBLIC_URL",
] as const;

type RequiredName = (typeof REQUIRED)[number];

function readEnvironment(): Record<RequiredName, string> {
  const missing = REQUIRED.filter((name) => !process.env[name]);
  if (missing.length) throw new Error(`Missing environment variables: ${missing.join(", ")}`);
  return Object.fromEntries(REQUIRED.map((name) => [name, process.env[name] as string])) as Record<
    RequiredName,
    string
  >;
}

const env = readEnvironment();
const port = Number(process.env.APP_PUBLIC_PORT ?? "4173");
const today = process.env.LIGHTFALL_TODAY;
if (today !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(today)) {
  throw new Error("LIGHTFALL_TODAY must be YYYY-MM-DD");
}

export const config = {
  port,
  publicUrl: env.APP_PUBLIC_URL.replace(/\/+$/, ""),
  today,
  databaseUrl: env.DATABASE_URL,
  killbill: {
    url: env.KILLBILL_URL.replace(/\/+$/, ""),
    username: env.KILLBILL_USERNAME,
    password: env.KILLBILL_PASSWORD,
    apiKey: env.KILLBILL_API_KEY,
    apiSecret: env.KILLBILL_API_SECRET,
  },
  smtp: { host: env.SMTP_HOST, port: Number(env.SMTP_PORT), from: env.MAIL_FROM },
  s3: {
    endpoint: env.S3_ENDPOINT.replace(/\/+$/, ""),
    region: env.S3_REGION,
    bucket: env.S3_BUCKET,
    forcePathStyle: (process.env.S3_FORCE_PATH_STYLE ?? "true").toLowerCase() === "true",
    accessKeyId: env.S3_ACCESS_KEY_ID,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY,
  },
  pocketbase: {
    url: env.POCKETBASE_URL.replace(/\/+$/, ""),
    email: env.POCKETBASE_ADMIN_EMAIL,
    password: env.POCKETBASE_ADMIN_PASSWORD,
  },
} as const;

/** Any provider call that cannot connect or gets no reply within this long counts as unreachable. */
export const PROVIDER_TIMEOUT_MS = 10_000;
/** The admin health check waits no longer than this per service. */
export const HEALTH_TIMEOUT_MS = 2_000;
