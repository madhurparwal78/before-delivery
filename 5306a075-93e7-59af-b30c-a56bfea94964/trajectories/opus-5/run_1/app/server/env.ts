function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value;
}

function wholeSeconds(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be a whole number of seconds from ${min} to ${max}`);
  }
  return value;
}

const port = wholeSeconds('APP_PUBLIC_PORT', 4173, 1, 65535);

export const env = {
  port,
  baseUrl: (process.env.APP_BASE_URL ?? `http://localhost:${port}`).replace(/\/+$/u, ''),
  databaseUrl: required('DATABASE_URL'),
  s3: {
    endpoint: required('S3_ENDPOINT').replace(/\/+$/u, ''),
    region: process.env.S3_REGION ?? 'us-east-1',
    bucket: required('S3_BUCKET'),
    forcePathStyle: (process.env.S3_FORCE_PATH_STYLE ?? 'true') === 'true',
    accessKeyId: required('S3_ACCESS_KEY_ID'),
    secretAccessKey: required('S3_SECRET_ACCESS_KEY'),
  },
  smtp: {
    host: required('SMTP_HOST'),
    port: wholeSeconds('SMTP_PORT', 1025, 1, 65535),
  },
  mailFrom: process.env.MAIL_FROM ?? 'Loomwise Evidence Desk <updates@loomwise.example>',
  attachmentRetrySeconds: wholeSeconds('ATTACHMENT_RETRY_SECONDS', 10, 1, 60),
  outboxRetrySeconds: wholeSeconds('OUTBOX_RETRY_SECONDS', 10, 1, 60),
  inviteTtlSeconds: wholeSeconds('INVITE_TTL_SECONDS', 604800, 1, 31536000),
  sessionIdleSeconds: wholeSeconds('SESSION_IDLE_SECONDS', 43200, 1, 31536000),
} as const;
