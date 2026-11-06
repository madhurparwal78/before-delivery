// The only module that reads the process environment.

function requiredText(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") throw new Error(`Missing required environment variable ${name}`);
  return value;
}

function wholeSeconds(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`${name} must be a whole number of seconds`);
  return parsed;
}

export interface Config {
  port: number;
  databaseUrl: string;
  vault: {
    endpoint: string;
    region: string;
    bucket: string;
    forcePathStyle: boolean;
    accessKeyId: string;
    secretAccessKey: string;
  };
  ethStaleSeconds: number;
  staffSessionIdleSeconds: number;
}

export function loadConfig(): Config {
  return {
    port: wholeSeconds("APP_PUBLIC_PORT", 4173),
    databaseUrl: requiredText("DATABASE_URL"),
    vault: {
      endpoint: requiredText("S3_ENDPOINT").replace(/\/+$/, ""),
      region: process.env["S3_REGION"] || "us-east-1",
      bucket: requiredText("S3_BUCKET"),
      forcePathStyle: (process.env["S3_FORCE_PATH_STYLE"] ?? "true") !== "false",
      accessKeyId: requiredText("S3_ACCESS_KEY_ID"),
      secretAccessKey: requiredText("S3_SECRET_ACCESS_KEY"),
    },
    ethStaleSeconds: wholeSeconds("ETH_STALE_SECONDS", 120),
    staffSessionIdleSeconds: wholeSeconds("STAFF_SESSION_IDLE_SECONDS", 1800),
  };
}
