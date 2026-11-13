function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') throw new Error(`Missing environment variable ${name}`);
  return value;
}

function seconds(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`Invalid environment variable ${name}`);
  return parsed;
}

const port = Number.parseInt(process.env.APP_PUBLIC_PORT ?? '4173', 10);
const publicUrl = (process.env.APP_PUBLIC_URL ?? `http://localhost:${port}`).replace(/\/+$/, '');

export const config = {
  databaseUrl: required('DATABASE_URL'),
  smtpHost: required('SMTP_HOST'),
  smtpPort: Number.parseInt(required('SMTP_PORT'), 10),
  mailFrom: required('MAIL_FROM'),
  s3Endpoint: required('S3_ENDPOINT'),
  s3Region: required('S3_REGION'),
  s3Bucket: required('S3_BUCKET'),
  s3ForcePathStyle: required('S3_FORCE_PATH_STYLE') === 'true',
  s3AccessKeyId: required('S3_ACCESS_KEY_ID'),
  s3SecretAccessKey: required('S3_SECRET_ACCESS_KEY'),
  gotenbergUrl: required('GOTENBERG_URL'),
  port,
  publicUrl,
  publicOrigin: new URL(publicUrl).origin,
  answerWindowSeconds: seconds('ANSWER_WINDOW_SECONDS', 172800),
  reminderLeadSeconds: seconds('REMINDER_LEAD_SECONDS', 21600),
  inviteTtlSeconds: seconds('INVITE_TTL_SECONDS', 604800),
} as const;

export const JSON_BODY_LIMIT = 65536;
export const RECEIPT_BODY_LIMIT = 5242880;
