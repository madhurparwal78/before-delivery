// The one place the environment is read. Service URLs and credentials have no fallback.

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`The environment variable ${name} must be set.`);
  return value;
}

function wholeNumber(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`The environment variable ${name} must be a whole number from ${min} to ${max}.`);
  }
  return value;
}

export const config = {
  port: wholeNumber("APP_PUBLIC_PORT", 4173, 1, 65535),
  databaseUrl: required("DATABASE_URL"),
  storage: {
    endpoint: required("S3_ENDPOINT").replace(/\/+$/, ""),
    region: process.env.S3_REGION || "us-east-1",
    bucket: required("S3_BUCKET"),
    forcePathStyle: (process.env.S3_FORCE_PATH_STYLE ?? "true").toLowerCase() !== "false",
    accessKeyId: required("S3_ACCESS_KEY_ID"),
    secretAccessKey: required("S3_SECRET_ACCESS_KEY"),
  },
  billing: {
    url: required("KILLBILL_URL").replace(/\/+$/, ""),
    username: required("KILLBILL_USERNAME"),
    password: required("KILLBILL_PASSWORD"),
    apiKey: required("KILLBILL_API_KEY"),
    apiSecret: required("KILLBILL_API_SECRET"),
  },
  mail: {
    host: required("SMTP_HOST"),
    port: wholeNumber("SMTP_PORT", 25, 1, 65535),
    from: process.env.MAIL_FROM || "Lumenfold Dispatch <dispatch@lumenfold.example>",
  },
  jobRunSeconds: wholeNumber("JOB_RUN_SECONDS", 8, 1, 600),
  leaseSeconds: wholeNumber("LEASE_SECONDS", 30, 1, 3600),
  retentionDaySeconds: wholeNumber("RETENTION_DAY_SECONDS", 86_400, 1, 86_400 * 366),
  webhookRetryBaseSeconds: wholeNumber("WEBHOOK_RETRY_BASE_SECONDS", 2, 1, 3600),
  outboundAllowedHosts: (process.env.OUTBOUND_ALLOWED_HOSTS ?? "")
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean),
};
