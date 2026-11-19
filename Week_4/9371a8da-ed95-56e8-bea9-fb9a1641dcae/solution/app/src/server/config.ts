// Every service address, credential and time setting, read once from the environment at start.

function text(name: string, fallback?: string): string {
  const value = process.env[name];
  if (value !== undefined && value !== "") return value;
  if (fallback !== undefined) return fallback;
  throw new Error(`${name} is not set`);
}

function seconds(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? "");
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

const port = Number(process.env.APP_PUBLIC_PORT) || 4173;

export const config = {
  port,
  databaseUrl: text("DATABASE_URL"),
  s3: {
    endpoint: text("S3_ENDPOINT").replace(/\/+$/, ""),
    region: text("S3_REGION"),
    bucket: text("S3_BUCKET"),
    forcePathStyle: text("S3_FORCE_PATH_STYLE", "true").toLowerCase() !== "false",
    accessKeyId: text("S3_ACCESS_KEY_ID"),
    secretAccessKey: text("S3_SECRET_ACCESS_KEY"),
  },
  smtp: {
    host: text("SMTP_HOST"),
    port: Number(text("SMTP_PORT")),
  },
  mailFrom: text("MAIL_FROM", "Marginalia <no-reply@marginalia.test>"),
  appBaseUrl: text("APP_BASE_URL", `http://localhost:${port}`).replace(/\/+$/, ""),
  inviteTtlSeconds: seconds("INVITE_TTL_SECONDS", 604800),
  inviteWindowSeconds: seconds("INVITE_WINDOW_SECONDS", 3600),
  idempotencyTtlSeconds: seconds("IDEMPOTENCY_TTL_SECONDS", 86400),
  mentionRetrySeconds: seconds("MENTION_RETRY_SECONDS", 600),
  shareLinkTtlSeconds: seconds("SHARE_LINK_TTL_SECONDS", 2592000),
} as const;
