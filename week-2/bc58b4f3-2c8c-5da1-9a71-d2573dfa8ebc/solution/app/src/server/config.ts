// The only place the server reads its environment. Every service URL and credential comes from here.

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") {
    throw new Error(`Environment variable ${name} is required`);
  }
  return value;
}

function integer(name: string, fallback?: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") {
    if (fallback === undefined) throw new Error(`Environment variable ${name} is required`);
    return fallback;
  }
  const value = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`Environment variable ${name} must be a positive integer`);
  return value;
}

export const config = {
  port: integer("APP_PUBLIC_PORT", 4173),
  databaseUrl: required("DATABASE_URL"),
  smtp: {
    host: required("SMTP_HOST"),
    port: integer("SMTP_PORT"),
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
    forcePathStyle: required("S3_FORCE_PATH_STYLE").toLowerCase() === "true",
    accessKeyId: required("S3_ACCESS_KEY_ID"),
    secretAccessKey: required("S3_SECRET_ACCESS_KEY"),
  },
  billingRetrySeconds: integer("BILLING_RETRY_SECONDS", 10),
  sessionTtlSeconds: integer("SESSION_TTL_SECONDS", 43_200),
};
