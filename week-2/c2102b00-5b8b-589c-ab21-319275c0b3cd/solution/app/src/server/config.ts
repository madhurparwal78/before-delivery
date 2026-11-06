// Every service URL, credential and setting, read once from the environment at start.
import path from "node:path";

function required(name: string): string {
  return process.env[name] ?? "";
}

function retrySeconds(raw: string | undefined): number {
  const value = Number(raw);
  return Number.isInteger(value) && value >= 1 && value <= 300 ? value : 30;
}

export const config = {
  port: Number(process.env.APP_PUBLIC_PORT ?? "") || 4173,
  dbPath: path.resolve(process.env.TALLY_DB_PATH || "data/tally.db"),
  killBill: {
    url: required("KILLBILL_URL").replace(/\/+$/, ""),
    username: required("KILLBILL_USERNAME"),
    password: required("KILLBILL_PASSWORD"),
    apiKey: required("KILLBILL_API_KEY"),
    apiSecret: required("KILLBILL_API_SECRET"),
    keyPrefix: process.env.TALLY_KB_KEY_PREFIX || "tally",
  },
  mail: {
    host: required("SMTP_HOST"),
    port: Number(required("SMTP_PORT")),
    from: required("MAIL_FROM"),
    retrySeconds: retrySeconds(process.env.MAIL_RETRY_SECONDS),
  },
  storage: {
    endpoint: required("S3_ENDPOINT").replace(/\/+$/, ""),
    region: required("S3_REGION"),
    bucket: required("S3_BUCKET"),
    forcePathStyle: required("S3_FORCE_PATH_STYLE").toLowerCase() === "true",
    accessKeyId: required("S3_ACCESS_KEY_ID"),
    secretAccessKey: required("S3_SECRET_ACCESS_KEY"),
  },
} as const;

/** The SMTP endpoint this process owns: queued mail records it, and only this process delivers it. */
export const mailEndpoint = `${config.mail.host}:${config.mail.port}`;
