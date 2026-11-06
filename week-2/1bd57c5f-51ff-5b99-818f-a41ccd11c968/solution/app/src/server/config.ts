// Every setting the server reads, in one place. Service locations and credentials come
// only from the environment; the literals below are the defaults the brief documents.

const env = process.env;

const port = Number(env.APP_PUBLIC_PORT || 4173);

function required(name: string): string {
  const value = env[name];
  if (!value) throw new Error(`${name} must be set`);
  return value;
}

function summaryMinutes(value: string): number {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  if (!match) throw new Error("SUMMARY_LOCAL_TIME must be a 24-hour HH:MM time");
  return Number(match[1]) * 60 + Number(match[2]);
}

function wholeNumber(name: string, fallback: number, min: number, max: number): number {
  const raw = env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${name} must be a whole number from ${min} to ${max}`);
  return value;
}

export const config = {
  port,
  publicUrl: (env.APP_PUBLIC_URL || `http://localhost:${port}`).replace(/\/+$/, ""),
  databaseUrl: required("DATABASE_URL"),
  s3: {
    endpoint: required("S3_ENDPOINT").replace(/\/+$/, ""),
    region: required("S3_REGION"),
    bucket: required("S3_BUCKET"),
    forcePathStyle: env.S3_FORCE_PATH_STYLE === "true",
    accessKeyId: required("S3_ACCESS_KEY_ID"),
    secretAccessKey: required("S3_SECRET_ACCESS_KEY"),
  },
  smtp: {
    host: required("SMTP_HOST"),
    port: Number(required("SMTP_PORT")),
  },
  mailFrom: env.MAIL_FROM || "Snaglight <notices@snaglight.example>",
  sessionIdleMinutes: wholeNumber("SESSION_IDLE_MINUTES", 720, 1, 525_600),
  /** The job-local time from which the daily summary is due, as minutes after midnight. */
  summaryMinutes: summaryMinutes(env.SUMMARY_LOCAL_TIME || "18:00"),
  summaryQuietSeconds: wholeNumber("SUMMARY_QUIET_SECONDS", 60, 0, 60),
  eventRetentionCount: wholeNumber("EVENT_RETENTION_COUNT", 1000, 10, 100_000),
} as const;
