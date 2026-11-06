export interface Config {
  port: number;
  publicUrl: string;
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
  inviteTtlSeconds: number;
  knockTtlSeconds: number;
  presenceAwaySeconds: number;
  streamGraceSeconds: number;
  outboxRetrySeconds: number;
  idempotencyTtlSeconds: number;
  serverClockStart: string | null;
}

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function boolEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  return raw === "true" || raw === "1";
}

export function loadConfig(): Config {
  const port = intEnv("APP_PUBLIC_PORT", 4173);
  const publicUrl = (process.env.APP_PUBLIC_URL || `http://127.0.0.1:${port}`).replace(/\/+$/, "");
  return {
    port,
    publicUrl,
    databaseUrl: requireEnv("DATABASE_URL"),
    smtpHost: requireEnv("SMTP_HOST"),
    smtpPort: intEnv("SMTP_PORT", 1025),
    mailFrom: requireEnv("MAIL_FROM"),
    killbillUrl: requireEnv("KILLBILL_URL").replace(/\/+$/, ""),
    killbillUsername: requireEnv("KILLBILL_USERNAME"),
    killbillPassword: requireEnv("KILLBILL_PASSWORD"),
    killbillApiKey: requireEnv("KILLBILL_API_KEY"),
    killbillApiSecret: requireEnv("KILLBILL_API_SECRET"),
    s3Endpoint: requireEnv("S3_ENDPOINT").replace(/\/+$/, ""),
    s3Region: process.env.S3_REGION || "us-east-1",
    s3Bucket: requireEnv("S3_BUCKET"),
    s3ForcePathStyle: boolEnv("S3_FORCE_PATH_STYLE", true),
    s3AccessKeyId: requireEnv("S3_ACCESS_KEY_ID"),
    s3SecretAccessKey: requireEnv("S3_SECRET_ACCESS_KEY"),
    inviteTtlSeconds: intEnv("INVITE_TTL_SECONDS", 604800),
    knockTtlSeconds: intEnv("KNOCK_TTL_SECONDS", 60),
    presenceAwaySeconds: intEnv("PRESENCE_AWAY_SECONDS", 600),
    streamGraceSeconds: intEnv("STREAM_GRACE_SECONDS", 60),
    outboxRetrySeconds: intEnv("OUTBOX_RETRY_SECONDS", 30),
    idempotencyTtlSeconds: intEnv("IDEMPOTENCY_TTL_SECONDS", 86400),
    serverClockStart: process.env.SERVER_CLOCK_START || null,
  };
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing environment variable ${name}`);
  return v;
}
