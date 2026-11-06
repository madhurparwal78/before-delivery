// The only reader of process.env. Every service URL and credential comes from here, read once at start.

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") throw new Error(`${name} must be set`);
  return value;
}

function seconds(name: string, fallback: number): number {
  const raw = process.env[name];
  const value = raw === undefined || raw === "" ? fallback : Number(raw);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a whole number of seconds`);
  return value;
}

interface Config {
  port: number;
  baseUrl: string;
  databaseUrl: string;
  killbill: { url: string; username: string; password: string; apiKey: string; apiSecret: string };
  smtp: { host: string; port: number; from: string };
  s3: { endpoint: string; region: string; bucket: string; forcePathStyle: boolean; accessKeyId: string; secretAccessKey: string };
  inspectionLinkTtlSeconds: number;
  fileUrlTtlSeconds: number;
}

function loadConfig(): Config {
  return {
    port: process.env.APP_PUBLIC_PORT ? Number(process.env.APP_PUBLIC_PORT) : 4173,
    baseUrl: (process.env.APP_BASE_URL || "http://localhost:4173").replace(/\/+$/, ""),
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
      forcePathStyle: (process.env.S3_FORCE_PATH_STYLE ?? "").toLowerCase() === "true",
      accessKeyId: required("S3_ACCESS_KEY_ID"),
      secretAccessKey: required("S3_SECRET_ACCESS_KEY"),
    },
    inspectionLinkTtlSeconds: seconds("INSPECTION_LINK_TTL_SECONDS", 259_200),
    fileUrlTtlSeconds: seconds("FILE_URL_TTL_SECONDS", 300),
  };
}

export const config = loadConfig();
