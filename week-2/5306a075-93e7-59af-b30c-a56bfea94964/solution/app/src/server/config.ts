// The only module that reads the environment. Every service address and credential comes from here.

function text(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value === undefined || value === "" ? undefined : value;
}

function required(name: string): string {
  const value = text(name);
  if (value === undefined) throw new Error(`${name} must be set`);
  return value;
}

function wholeNumber(name: string, fallback: number | undefined, min: number, max: number): number {
  const raw = text(name);
  if (raw === undefined) {
    if (fallback === undefined) throw new Error(`${name} must be set`);
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be a whole number from ${min} to ${max}`);
  }
  return value;
}

const port = wholeNumber("APP_PUBLIC_PORT", 4173, 1, 65535);

export const config = {
  port,
  baseUrl: (text("APP_BASE_URL") ?? `http://localhost:${port}`).replace(/\/+$/, ""),
  databaseUrl: required("DATABASE_URL"),
  storage: {
    endpoint: required("S3_ENDPOINT").replace(/\/+$/, ""),
    region: required("S3_REGION"),
    bucket: required("S3_BUCKET"),
    forcePathStyle: text("S3_FORCE_PATH_STYLE")?.toLowerCase() === "true",
    accessKeyId: required("S3_ACCESS_KEY_ID"),
    secretAccessKey: required("S3_SECRET_ACCESS_KEY"),
  },
  smtp: {
    host: required("SMTP_HOST"),
    port: wholeNumber("SMTP_PORT", undefined, 1, 65535),
  },
  mailFrom: text("MAIL_FROM") ?? "Loomwise Evidence Desk <updates@loomwise.example>",
  attachmentRetrySeconds: wholeNumber("ATTACHMENT_RETRY_SECONDS", 10, 1, 60),
  outboxRetrySeconds: wholeNumber("OUTBOX_RETRY_SECONDS", 10, 1, 60),
  inviteTtlSeconds: wholeNumber("INVITE_TTL_SECONDS", 604800, 1, Number.MAX_SAFE_INTEGER),
  sessionIdleSeconds: wholeNumber("SESSION_IDLE_SECONDS", 43200, 1, Number.MAX_SAFE_INTEGER),
} as const;
