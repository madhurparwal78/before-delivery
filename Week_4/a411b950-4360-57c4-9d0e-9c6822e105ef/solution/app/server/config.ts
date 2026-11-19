// The one place the environment is read. Nothing here reaches the browser.

function required(name: string): string {
  return process.env[name]?.trim() ?? "";
}

function integer(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  return Number.isSafeInteger(value) && value >= 0 ? value : fallback;
}

const port = integer("APP_PUBLIC_PORT", 4173);
const publicUrl = (process.env.APP_PUBLIC_URL?.trim() || `http://localhost:${port}`).replace(/\/+$/, "");

export const config = {
  port,
  publicUrl,
  publicOrigin: new URL(publicUrl).origin,
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
    port: Number.parseInt(required("SMTP_PORT"), 10),
    from: required("MAIL_FROM"),
  },
  killbill: {
    url: required("KILLBILL_URL").replace(/\/+$/, ""),
    username: required("KILLBILL_USERNAME"),
    password: required("KILLBILL_PASSWORD"),
    apiKey: required("KILLBILL_API_KEY"),
    apiSecret: required("KILLBILL_API_SECRET"),
  },
  proposalTtlSeconds: integer("PROPOSAL_LINK_TTL_SECONDS", 1_209_600),
  pacing: {
    perSender: integer("ENQUIRY_LIMIT_PER_SENDER", 3),
    perIp: integer("ENQUIRY_LIMIT_PER_IP", 200),
    windowSeconds: integer("ENQUIRY_RATE_WINDOW_SECONDS", 600),
  },
  mailRetrySeconds: Math.max(1, integer("MAIL_RETRY_SECONDS", 10)),
} as const;
