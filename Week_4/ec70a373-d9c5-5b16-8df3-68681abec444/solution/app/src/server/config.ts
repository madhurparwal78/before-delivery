// Every service URL, credential and setting, read once from the environment at start.

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") throw new Error(`Missing environment variable ${name}`);
  return value;
}

function wholeNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  if (!/^\d+$/.test(raw)) throw new Error(`${name} must be a whole number`);
  return Number(raw);
}

function clockStart(): number | null {
  const raw = process.env.PILOTLIGHT_CLOCK_START;
  if (raw === undefined || raw === "") return null;
  const ms = Date.parse(raw);
  if (Number.isNaN(ms)) throw new Error("PILOTLIGHT_CLOCK_START must be an ISO-8601 instant");
  return ms;
}

const SEED_SETS = ["site-day", "pack-expiry"] as const;
export type SeedSet = (typeof SEED_SETS)[number];

function seedSet(): SeedSet | null {
  const raw = process.env.PILOTLIGHT_SEED_SET;
  if (raw === undefined || raw === "") return null;
  const found = SEED_SETS.find((name) => name === raw);
  if (!found) throw new Error("PILOTLIGHT_SEED_SET must be site-day or pack-expiry");
  return found;
}

export const config = {
  port: wholeNumber("APP_PUBLIC_PORT", 4173),
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
    forcePathStyle: required("S3_FORCE_PATH_STYLE") === "true",
    accessKeyId: required("S3_ACCESS_KEY_ID"),
    secretAccessKey: required("S3_SECRET_ACCESS_KEY"),
  },
  smtp: {
    host: required("SMTP_HOST"),
    port: Number(required("SMTP_PORT")),
    from: required("MAIL_FROM"),
  },
  holdTtlSeconds: wholeNumber("HOLD_TTL_SECONDS", 600),
  inspectorLinkTtlSeconds: wholeNumber("INSPECTOR_LINK_TTL_SECONDS", 259200),
  sessionIdleSeconds: wholeNumber("SESSION_IDLE_SECONDS", 1800),
  sessionAbsoluteSeconds: wholeNumber("SESSION_ABSOLUTE_SECONDS", 43200),
  signInThrottleWindowSeconds: wholeNumber("SIGN_IN_THROTTLE_WINDOW_SECONDS", 900),
  clockStart: clockStart(),
  seedSet: seedSet(),
} as const;
