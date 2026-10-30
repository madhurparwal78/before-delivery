// The one place the server reads its environment.

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") throw new Error(`Environment variable ${name} is not set`);
  return value;
}

function wholeNumber(name: string, fallback: number): number {
  const value = process.env[name];
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`Environment variable ${name} must be a whole number`);
  return parsed;
}

export const config = {
  port: wholeNumber("APP_PUBLIC_PORT", 4173),
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
    port: Number(required("SMTP_PORT")),
    from: required("MAIL_FROM"),
  },
  pickupWindowSeconds: wholeNumber("SHEDLINE_PICKUP_WINDOW_SECONDS", 172_800),
  reminderLeadSeconds: wholeNumber("SHEDLINE_REMINDER_LEAD_SECONDS", 86_400),
} as const;
