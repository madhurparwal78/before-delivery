// The one place the server reads its environment. Every provider URL and credential comes from here.

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") throw new Error(`Missing environment variable ${name}`);
  return value;
}

function wholeNumber(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  if (!/^\d+$/.test(raw) || Number(raw) < min || Number(raw) > max) {
    throw new Error(`${name} must be a whole number from ${min} to ${max}`);
  }
  return Number(raw);
}

function port(name: string): number {
  const raw = required(name);
  if (!/^\d+$/.test(raw) || Number(raw) < 1 || Number(raw) > 65535) throw new Error(`${name} must be a port number`);
  return Number(raw);
}

export const config = {
  port: wholeNumber("APP_PUBLIC_PORT", 4173, 1, 65535),
  publicUrl: required("APP_PUBLIC_URL").replace(/\/+$/, ""),
  databaseUrl: required("DATABASE_URL"),
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
    forcePathStyle: required("S3_FORCE_PATH_STYLE").toLowerCase() === "true",
    accessKeyId: required("S3_ACCESS_KEY_ID"),
    secretAccessKey: required("S3_SECRET_ACCESS_KEY"),
  },
  smtp: {
    host: required("SMTP_HOST"),
    port: port("SMTP_PORT"),
    from: required("MAIL_FROM"),
  },
  reminderSweepSeconds: wholeNumber("REMINDER_SWEEP_SECONDS", 60, 1, 60),
  sessionIdleSeconds: wholeNumber("SESSION_IDLE_SECONDS", 1800, 10, 86_400),
} as const;
