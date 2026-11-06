import { Pool, PoolClient } from "pg";

export interface Config {
  databaseUrl: string;
  smtpHost: string;
  smtpPort: number;
  mailFrom: string;
  killbillUrl: string;
  killbillUsername: string;
  killbillPassword: string;
  killbillApiKey: string;
  killbillApiSecret: string;
  s3Endpoint: string;
  s3Region: string;
  s3Bucket: string;
  s3ForcePathStyle: boolean;
  s3AccessKeyId: string;
  s3SecretAccessKey: string;
  publicPort: number;
  billingRetrySeconds: number;
  sessionTtlSeconds: number;
}

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

export function loadConfig(): Config {
  const required = (name: string): string => {
    const v = process.env[name];
    if (!v) throw new Error(`Missing required environment variable ${name}`);
    return v;
  };
  return {
    databaseUrl: required("DATABASE_URL"),
    smtpHost: required("SMTP_HOST"),
    smtpPort: intEnv("SMTP_PORT", 1025),
    mailFrom: required("MAIL_FROM"),
    killbillUrl: required("KILLBILL_URL").replace(/\/$/, ""),
    killbillUsername: required("KILLBILL_USERNAME"),
    killbillPassword: required("KILLBILL_PASSWORD"),
    killbillApiKey: required("KILLBILL_API_KEY"),
    killbillApiSecret: required("KILLBILL_API_SECRET"),
    s3Endpoint: required("S3_ENDPOINT").replace(/\/$/, ""),
    s3Region: required("S3_REGION"),
    s3Bucket: required("S3_BUCKET"),
    s3ForcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
    s3AccessKeyId: required("S3_ACCESS_KEY_ID"),
    s3SecretAccessKey: required("S3_SECRET_ACCESS_KEY"),
    publicPort: intEnv("APP_PUBLIC_PORT", 4173),
    billingRetrySeconds: intEnv("BILLING_RETRY_SECONDS", 10),
    sessionTtlSeconds: intEnv("SESSION_TTL_SECONDS", 43200),
  };
}

export type Db = Pool;
export type Tx = PoolClient;

export async function withTx<T>(db: Db, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* connection already broken */
    }
    throw e;
  } finally {
    client.release();
  }
}
