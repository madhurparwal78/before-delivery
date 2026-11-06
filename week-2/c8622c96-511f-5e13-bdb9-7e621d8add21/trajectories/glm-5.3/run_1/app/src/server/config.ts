// Every service location and credential is read from the environment at start.
// None is ever hard-coded, logged or sent to the browser.
export interface AppConfig {
  port: number;
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
  smtp: { host: string; port: number; from: string };
  clockControl: boolean;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable ${name}`);
  return value;
}

export function loadConfig(): AppConfig {
  const s3Endpoint = required("S3_ENDPOINT");
  return {
    port: Number(process.env.APP_PUBLIC_PORT ?? "4173"),
    databaseUrl: required("DATABASE_URL"),
    s3: {
      endpoint: s3Endpoint.replace(/\/$/, ""),
      region: process.env.S3_REGION ?? "us-east-1",
      bucket: required("S3_BUCKET"),
      forcePathStyle: (process.env.S3_FORCE_PATH_STYLE ?? "true") !== "false",
      accessKeyId: required("S3_ACCESS_KEY_ID"),
      secretAccessKey: required("S3_SECRET_ACCESS_KEY"),
    },
    killbill: {
      // Accept both a bare host and a full /1.0/kb base.
      url: normalizeKillbillUrl(required("KILLBILL_URL")),
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
    clockControl: process.env.APP_CLOCK_CONTROL === "on",
  };
}

function normalizeKillbillUrl(url: string): string {
  const bare = url.replace(/\/$/, "");
  if (bare.endsWith("/1.0/kb")) return bare;
  return `${bare}/1.0/kb`;
}
