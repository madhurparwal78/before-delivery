// Every setting the server reads from the environment, read once at start.

export interface Config {
  databaseUrl: string;
  killbill: { url: string; username: string; password: string; apiKey: string; apiSecret: string };
  s3: {
    endpoint: string;
    region: string;
    bucket: string;
    forcePathStyle: boolean;
    accessKeyId: string;
    secretAccessKey: string;
  };
  smtp: { host: string; port: number };
  port: number;
  holdSeconds: number;
  /** Epoch milliseconds the server clock starts from, or null for the real clock. */
  clockStart: number | null;
}

const INSTANT_WITH_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/;

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (value === undefined || value.trim() === "") throw new Error(`${name} must be set`);
  return value;
}

function wholeNumber(raw: string, name: string): number {
  if (!/^\d+$/.test(raw.trim()) || Number(raw) <= 0) throw new Error(`${name} must be a positive whole number`);
  return Number(raw);
}

export function readConfig(env: NodeJS.ProcessEnv): Config {
  const now = env.PASSBOARD_NOW;
  let clockStart: number | null = null;
  if (now !== undefined && now !== "") {
    const parsed = Date.parse(now);
    if (!INSTANT_WITH_OFFSET.test(now) || Number.isNaN(parsed)) {
      throw new Error("PASSBOARD_NOW must be an ISO 8601 instant with an offset, for example 2027-02-10T07:40:00-06:00");
    }
    clockStart = parsed;
  }
  return {
    databaseUrl: required(env, "DATABASE_URL"),
    killbill: {
      url: required(env, "KILLBILL_URL").replace(/\/+$/, ""),
      username: required(env, "KILLBILL_USERNAME"),
      password: required(env, "KILLBILL_PASSWORD"),
      apiKey: required(env, "KILLBILL_API_KEY"),
      apiSecret: required(env, "KILLBILL_API_SECRET"),
    },
    s3: {
      endpoint: required(env, "S3_ENDPOINT").replace(/\/+$/, ""),
      region: required(env, "S3_REGION"),
      bucket: required(env, "S3_BUCKET"),
      forcePathStyle: (env.S3_FORCE_PATH_STYLE ?? "").toLowerCase() === "true",
      accessKeyId: required(env, "S3_ACCESS_KEY_ID"),
      secretAccessKey: required(env, "S3_SECRET_ACCESS_KEY"),
    },
    smtp: { host: required(env, "SMTP_HOST"), port: wholeNumber(required(env, "SMTP_PORT"), "SMTP_PORT") },
    port: env.APP_PUBLIC_PORT ? wholeNumber(env.APP_PUBLIC_PORT, "APP_PUBLIC_PORT") : 4173,
    holdSeconds: env.PASSBOARD_HOLD_SECONDS ? wholeNumber(env.PASSBOARD_HOLD_SECONDS, "PASSBOARD_HOLD_SECONDS") : 600,
    clockStart,
  };
}
