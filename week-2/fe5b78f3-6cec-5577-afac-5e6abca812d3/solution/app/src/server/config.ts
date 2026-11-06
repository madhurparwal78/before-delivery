// The one place the server reads its environment. Everything is read once, at start.

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} must be set`);
  return value;
}

function clockRate(raw: string | undefined): number {
  if (raw === undefined || raw === "") return 1;
  const rate = Number(raw);
  if (!Number.isInteger(rate) || rate < 1 || rate > 3600) throw new Error("RAIL_CLOCK_RATE must be an integer from 1 to 3600");
  return rate;
}

export interface Config {
  port: number;
  publicUrl: string | undefined;
  databaseUrl: string;
  killbill: { url: string; username: string; password: string; apiKey: string; apiSecret: string };
  smtp: { host: string; port: number; from: string };
  s3: { endpoint: string; region: string; bucket: string; forcePathStyle: boolean; accessKeyId: string; secretAccessKey: string };
  clock: { start: string | undefined; rate: number };
}

export function loadConfig(): Config {
  return {
    port: Number(process.env.APP_PUBLIC_PORT || 4173),
    publicUrl: process.env.APP_PUBLIC_URL,
    databaseUrl: required("DATABASE_URL"),
    killbill: {
      url: required("KILLBILL_URL").replace(/\/+$/, ""),
      username: required("KILLBILL_USERNAME"),
      password: required("KILLBILL_PASSWORD"),
      apiKey: required("KILLBILL_API_KEY"),
      apiSecret: required("KILLBILL_API_SECRET"),
    },
    smtp: { host: required("SMTP_HOST"), port: Number(required("SMTP_PORT")), from: required("MAIL_FROM") },
    s3: {
      endpoint: required("S3_ENDPOINT").replace(/\/+$/, ""),
      region: required("S3_REGION"),
      bucket: required("S3_BUCKET"),
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
      accessKeyId: required("S3_ACCESS_KEY_ID"),
      secretAccessKey: required("S3_SECRET_ACCESS_KEY"),
    },
    clock: { start: process.env.RAIL_CLOCK_START || undefined, rate: clockRate(process.env.RAIL_CLOCK_RATE) },
  };
}
