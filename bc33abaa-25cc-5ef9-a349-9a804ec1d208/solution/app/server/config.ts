// Every setting the server reads from the environment, read once at start.

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") throw new Error(`Environment variable ${name} is required`);
  return value;
}

function seconds(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`Environment variable ${name} must be a positive number of seconds`);
  return value;
}

const port = Number(process.env.APP_PUBLIC_PORT ?? "4173");

export const config = {
  port,
  publicUrl: (process.env.APP_PUBLIC_URL ?? `http://localhost:${port}`).replace(/\/+$/, ""),
  databaseUrl: required("DATABASE_URL"),
  pocketbase: {
    url: required("POCKETBASE_URL").replace(/\/+$/, ""),
    email: required("POCKETBASE_ADMIN_EMAIL"),
    password: required("POCKETBASE_ADMIN_PASSWORD"),
  },
  storage: {
    endpoint: required("S3_ENDPOINT").replace(/\/+$/, ""),
    region: required("S3_REGION"),
    bucket: required("S3_BUCKET"),
    forcePathStyle: (process.env.S3_FORCE_PATH_STYLE ?? "true").toLowerCase() !== "false",
    accessKeyId: required("S3_ACCESS_KEY_ID"),
    secretAccessKey: required("S3_SECRET_ACCESS_KEY"),
  },
  killbill: {
    url: required("KILLBILL_URL").replace(/\/+$/, ""),
    username: required("KILLBILL_USERNAME"),
    password: required("KILLBILL_PASSWORD"),
    apiKey: required("KILLBILL_API_KEY"),
    apiSecret: required("KILLBILL_API_SECRET"),
  },
  smtp: { host: required("SMTP_HOST"), port: Number(required("SMTP_PORT")) },
  mailFrom: process.env.MAIL_FROM ?? "Orrery Studio <studio@orrery-labs.test>",
  trialLengthSeconds: seconds("TRIAL_LENGTH_SECONDS", 1_209_600),
  dunningDaySeconds: seconds("DUNNING_DAY_SECONDS", 86_400),
  tokenWarningLeadSeconds: seconds("TOKEN_WARNING_LEAD_SECONDS", 86_400),
} as const;
