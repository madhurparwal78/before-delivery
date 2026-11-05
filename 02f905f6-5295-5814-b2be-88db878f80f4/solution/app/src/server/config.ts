// The one place that reads the environment. Nothing here is ever sent to the browser.

function env(name: string): string {
  return process.env[name] ?? "";
}

function seconds(name: string, fallback: number): number {
  const raw = process.env[name];
  const value = raw === undefined || raw === "" ? fallback : Number(raw);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

const port = Number(process.env.APP_PUBLIC_PORT || "4173");

export const config = {
  port: Number.isInteger(port) && port > 0 ? port : 4173,
  publicUrl: env("APP_PUBLIC_URL").replace(/\/+$/, ""),
  databaseUrl: env("DATABASE_URL"),
  s3: {
    endpoint: env("S3_ENDPOINT").replace(/\/+$/, ""),
    region: env("S3_REGION"),
    bucket: env("S3_BUCKET"),
    forcePathStyle: (process.env.S3_FORCE_PATH_STYLE ?? "").toLowerCase() === "true",
    accessKeyId: env("S3_ACCESS_KEY_ID"),
    secretAccessKey: env("S3_SECRET_ACCESS_KEY"),
  },
  killbill: {
    url: env("KILLBILL_URL").replace(/\/+$/, ""),
    username: env("KILLBILL_USERNAME"),
    password: env("KILLBILL_PASSWORD"),
    apiKey: env("KILLBILL_API_KEY"),
    apiSecret: env("KILLBILL_API_SECRET"),
  },
  smtp: {
    host: env("SMTP_HOST"),
    port: Number(env("SMTP_PORT")),
    from: env("MAIL_FROM"),
  },
  /** one studio hour, in milliseconds */
  hourMs: seconds("FIRING_HOUR_SECONDS", 3600) * 1000,
  /** one studio day, in milliseconds */
  dayMs: seconds("PICKUP_DAY_SECONDS", 86400) * 1000,
};
