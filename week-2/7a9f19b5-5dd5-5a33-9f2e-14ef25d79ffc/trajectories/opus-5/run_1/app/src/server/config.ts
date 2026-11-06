/**
 * Every service URL and credential is read from the environment at start. Nothing
 * here is ever sent to the browser or written into the built browser assets.
 */

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") throw new Error(`missing required environment variable ${name}`);
  return value;
}

function optional(name: string): string | null {
  const value = process.env[name];
  return value === undefined || value === "" ? null : value;
}

function port(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) {
    throw new Error(`environment variable ${name} is not a port number`);
  }
  return parsed;
}

export interface Config {
  databaseUrl: string;
  killbill: { url: string; username: string; password: string; apiKey: string; apiSecret: string };
  smtp: { host: string; port: number; from: string };
  s3: {
    endpoint: string;
    region: string;
    bucket: string;
    forcePathStyle: boolean;
    accessKeyId: string;
    secretAccessKey: string;
  };
  pocketbase: { url: string; adminEmail: string; adminPassword: string };
  app: { port: number; publicUrl: string };
  /** Overrides the server's New Zealand date for every date rule when set. */
  today: string | null;
}

export function loadConfig(): Config {
  return {
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
      port: port("SMTP_PORT", 1025),
      from: required("MAIL_FROM"),
    },
    s3: {
      endpoint: required("S3_ENDPOINT").replace(/\/+$/, ""),
      region: required("S3_REGION"),
      bucket: required("S3_BUCKET"),
      forcePathStyle: (optional("S3_FORCE_PATH_STYLE") ?? "true") !== "false",
      accessKeyId: required("S3_ACCESS_KEY_ID"),
      secretAccessKey: required("S3_SECRET_ACCESS_KEY"),
    },
    pocketbase: {
      url: required("POCKETBASE_URL").replace(/\/+$/, ""),
      adminEmail: required("POCKETBASE_ADMIN_EMAIL"),
      adminPassword: required("POCKETBASE_ADMIN_PASSWORD"),
    },
    app: {
      port: port("APP_PUBLIC_PORT", 4173),
      publicUrl: (optional("APP_PUBLIC_URL") ?? `http://127.0.0.1:${port("APP_PUBLIC_PORT", 4173)}`).replace(
        /\/+$/,
        "",
      ),
    },
    today: optional("LIGHTFALL_TODAY"),
  };
}

/** Any provider call that cannot connect, or gets no reply within this, is unreachable. */
export const PROVIDER_TIMEOUT_MS = 10_000;

/** The admin health panel waits no more than this per service. */
export const HEALTH_PROBE_TIMEOUT_MS = 2_000;
