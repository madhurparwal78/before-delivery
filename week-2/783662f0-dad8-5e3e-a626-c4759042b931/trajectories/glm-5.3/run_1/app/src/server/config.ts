/** Configuration from the environment, read once at start. Nothing is hard-coded. */

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") {
    console.error(`Missing required environment variable: ${name}`);
    process.exit(1);
  }
  return value.trim();
}

function optionalDuration(name: string, defaultSeconds: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return defaultSeconds;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    console.error(`Environment variable ${name} must be a positive number of seconds.`);
    process.exit(1);
  }
  return parsed;
}

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
  smtp: {
    host: string;
    port: number;
    from: string;
  };
  port: number;
  publicBase: string;
  billingGraceSeconds: number;
  inviteTtlSeconds: number;
  weatherPeriodSeconds: number;
  dayCycleSeconds: number;
}

let cached: Config | null = null;

export function loadConfig(): Config {
  if (cached !== null) return cached;
  const publicBase = (() => {
    const primary = process.env.PUBLIC_BASE_URL;
    if (primary !== undefined && primary.trim() !== "") return primary.trim().replace(/\/+$/, "");
    const fallback = process.env.APP_PUBLIC_URL;
    if (fallback === undefined || fallback.trim() === "") {
      console.error("Missing required environment variable: PUBLIC_BASE_URL");
      process.exit(1);
    }
    return fallback.trim().replace(/\/+$/, "");
  })();
  cached = {
    databaseUrl: required("DATABASE_URL"),
    s3: {
      endpoint: required("S3_ENDPOINT").replace(/\/+$/, ""),
      region: required("S3_REGION"),
      bucket: required("S3_BUCKET"),
      forcePathStyle: required("S3_FORCE_PATH_STYLE").toLowerCase() === "true",
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
      from: required("MAIL_FROM"),
    },
    port: Number(required("APP_PUBLIC_PORT")),
    publicBase,
    billingGraceSeconds: optionalDuration("BILLING_GRACE_SECONDS", 172800),
    inviteTtlSeconds: optionalDuration("INVITE_TTL_SECONDS", 259200),
    weatherPeriodSeconds: optionalDuration("WEATHER_PERIOD_SECONDS", 600),
    dayCycleSeconds: optionalDuration("DAY_CYCLE_SECONDS", 86400),
  };
  return cached;
}

export function config(): Config {
  if (cached === null) return loadConfig();
  return cached;
}
