// The one configuration module: every service address and credential comes from the environment
// at start (brief: Configuration and secrets) and never reaches the browser.

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

function milliseconds(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export const config = {
  port: Number(process.env.APP_PUBLIC_PORT) || 4173,
  publicUrl: required("APP_PUBLIC_URL").replace(/\/+$/, ""),
  databaseUrl: required("DATABASE_URL"),
  s3: {
    endpoint: required("S3_ENDPOINT").replace(/\/+$/, ""),
    region: required("S3_REGION"),
    bucket: required("S3_BUCKET"),
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
    accessKeyId: required("S3_ACCESS_KEY_ID"),
    secretAccessKey: required("S3_SECRET_ACCESS_KEY"),
  },
  smtp: {
    host: required("SMTP_HOST"),
    port: Number(required("SMTP_PORT")),
  },
  mailFrom: required("MAIL_FROM"),
  gradingRoutes: process.env.GRADING_ROUTES === "on",
  presenceTimeoutMs: milliseconds("PRESENCE_TIMEOUT_MS", 30000),
  versionIntervalMs: milliseconds("VERSION_INTERVAL_MS", 300000),
  inviteTtlMs: milliseconds("INVITE_TTL_MS", 604800000),
};
