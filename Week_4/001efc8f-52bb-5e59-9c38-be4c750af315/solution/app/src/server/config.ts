// The only module that reads process.env. Service URLs and credentials have no fallback.

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value;
}

function wholeNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value)) throw new Error(`${name} must be a whole number`);
  return value;
}

const port = wholeNumber("APP_PUBLIC_PORT", 4173);
const digestInterval = process.env.DIGEST_INTERVAL_SECONDS;

export const config = {
  port,
  publicUrl: (process.env.APP_PUBLIC_URL?.trim() || `http://localhost:${port}`).replace(/\/+$/, ""),
  databaseUrl: required("DATABASE_URL"),
  s3: {
    endpoint: required("S3_ENDPOINT").replace(/\/+$/, ""),
    region: required("S3_REGION"),
    bucket: required("S3_BUCKET"),
    forcePathStyle: required("S3_FORCE_PATH_STYLE").toLowerCase() === "true",
    accessKeyId: required("S3_ACCESS_KEY_ID"),
    secretAccessKey: required("S3_SECRET_ACCESS_KEY"),
  },
  smtp: {
    host: required("SMTP_HOST"),
    port: Number(required("SMTP_PORT")),
  },
  mailFrom: required("MAIL_FROM"),
  editWindowSeconds: wholeNumber("EDIT_WINDOW_SECONDS", 86_400),
  mentionUnansweredSeconds: wholeNumber("MENTION_UNANSWERED_SECONDS", 1_800),
  digestIntervalSeconds: digestInterval === undefined || digestInterval.trim() === "" ? null : wholeNumber("DIGEST_INTERVAL_SECONDS", 0),
  eventRetentionSeconds: wholeNumber("EVENT_RETENTION_SECONDS", 600),
  clockOffsetSeconds: wholeNumber("APP_CLOCK_OFFSET_SECONDS", 0),
} as const;
