// The only place the environment is read. Every service address and credential comes from here.

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") throw new Error(`${name} must be set`);
  return value;
}

function seconds(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) throw new Error(`${name} must be a whole number of seconds`);
  return value;
}

const port = seconds("APP_PUBLIC_PORT", 4173);

export const config = {
  port,
  instanceId: process.env.INSTANCE_ID || "a",
  publicBaseUrl: (process.env.PUBLIC_BASE_URL || `http://localhost:${port}`).replace(/\/+$/, ""),
  databaseUrl: required("DATABASE_URL"),
  s3: {
    endpoint: required("S3_ENDPOINT").replace(/\/+$/, ""),
    region: required("S3_REGION"),
    bucket: required("S3_BUCKET"),
    forcePathStyle: (process.env.S3_FORCE_PATH_STYLE ?? "true").toLowerCase() === "true",
    accessKeyId: required("S3_ACCESS_KEY_ID"),
    secretAccessKey: required("S3_SECRET_ACCESS_KEY"),
  },
  smtp: {
    host: required("SMTP_HOST"),
    port: seconds("SMTP_PORT", 25),
    from: required("MAIL_FROM"),
  },
  killbill: {
    url: required("KILLBILL_URL").replace(/\/+$/, ""),
    username: required("KILLBILL_USERNAME"),
    password: required("KILLBILL_PASSWORD"),
    apiKey: required("KILLBILL_API_KEY"),
    apiSecret: required("KILLBILL_API_SECRET"),
  },
  joinLinkGraceSeconds: seconds("JOIN_LINK_GRACE_SECONDS", 86400),
  deliveryRetrySeconds: seconds("DELIVERY_RETRY_SECONDS", 15),
  paymentGraceSeconds: seconds("PAYMENT_GRACE_SECONDS", 604800),
  trashPurgeSeconds: seconds("TRASH_PURGE_SECONDS", 2592000),
  signinWindowSeconds: seconds("SIGNIN_WINDOW_SECONDS", 900),
};
