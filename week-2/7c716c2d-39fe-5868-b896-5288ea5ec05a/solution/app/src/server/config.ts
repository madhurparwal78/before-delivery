// The one place the server reads its environment. Nothing here is ever sent to the browser.

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") throw new Error(`${name} is not set`);
  return value;
}

function seconds(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive number of seconds`);
  return value;
}

export const config = {
  port: Number(process.env.APP_PUBLIC_PORT || 4173),
  publicUrl: required("APP_PUBLIC_URL").replace(/\/+$/, ""),
  databaseUrl: required("DATABASE_URL"),
  smtp: {
    host: required("SMTP_HOST"),
    port: Number(required("SMTP_PORT")),
    from: required("MAIL_FROM"),
  },
  killbill: {
    url: required("KILLBILL_URL").replace(/\/+$/, ""),
    username: required("KILLBILL_USERNAME"),
    password: required("KILLBILL_PASSWORD"),
    apiKey: required("KILLBILL_API_KEY"),
    apiSecret: required("KILLBILL_API_SECRET"),
  },
  s3: {
    endpoint: required("S3_ENDPOINT").replace(/\/+$/, ""),
    region: required("S3_REGION"),
    bucket: required("S3_BUCKET"),
    forcePathStyle: (process.env.S3_FORCE_PATH_STYLE ?? "true").toLowerCase() !== "false",
    accessKeyId: required("S3_ACCESS_KEY_ID"),
    secretAccessKey: required("S3_SECRET_ACCESS_KEY"),
  },
  clockStart: process.env.SERVER_CLOCK_START || null,
  timers: {
    inviteTtl: seconds("INVITE_TTL_SECONDS", 604_800),
    knockTtl: seconds("KNOCK_TTL_SECONDS", 60),
    presenceAway: seconds("PRESENCE_AWAY_SECONDS", 600),
    streamGrace: seconds("STREAM_GRACE_SECONDS", 60),
    outboxRetry: seconds("OUTBOX_RETRY_SECONDS", 30),
    idempotencyTtl: seconds("IDEMPOTENCY_TTL_SECONDS", 86_400),
  },
};
