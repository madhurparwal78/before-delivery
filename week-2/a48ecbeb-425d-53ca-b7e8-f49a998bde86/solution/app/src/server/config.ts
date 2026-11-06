// Every service URL, credential and timing knob, read once from the environment at start.

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") throw new Error(`${name} is not set`);
  return value;
}

function seconds(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive number`);
  return value;
}

const databaseUrl = required("DATABASE_URL");

export const config = {
  port: Number(process.env.APP_PUBLIC_PORT || 4173),
  publicUrl: required("APP_PUBLIC_URL").replace(/\/$/, ""),
  databaseUrl,
  database: decodeURIComponent(new URL(databaseUrl).pathname.replace(/^\//, "")),
  pocketbase: {
    url: required("POCKETBASE_URL").replace(/\/$/, ""),
    email: required("POCKETBASE_ADMIN_EMAIL"),
    password: required("POCKETBASE_ADMIN_PASSWORD"),
  },
  s3: {
    endpoint: required("S3_ENDPOINT").replace(/\/$/, ""),
    region: required("S3_REGION"),
    bucket: required("S3_BUCKET"),
    forcePathStyle: required("S3_FORCE_PATH_STYLE") === "true",
    accessKeyId: required("S3_ACCESS_KEY_ID"),
    secretAccessKey: required("S3_SECRET_ACCESS_KEY"),
  },
  killbill: {
    url: required("KILLBILL_URL").replace(/\/$/, ""),
    username: required("KILLBILL_USERNAME"),
    password: required("KILLBILL_PASSWORD"),
    apiKey: required("KILLBILL_API_KEY"),
    apiSecret: required("KILLBILL_API_SECRET"),
  },
  mail: {
    smtpHost: required("SMTP_HOST"),
    smtpPort: Number(required("SMTP_PORT")),
    mailpitUrl: required("MAILPIT_URL").replace(/\/$/, ""),
    from: required("MAIL_FROM"),
  },
  holdSeconds: seconds("HOLD_SECONDS", 900),
  dunningDaySeconds: seconds("DUNNING_DAY_SECONDS", 86400),
  changeCutoffHours: seconds("CHANGE_CUTOFF_HOURS", 48),
} as const;
