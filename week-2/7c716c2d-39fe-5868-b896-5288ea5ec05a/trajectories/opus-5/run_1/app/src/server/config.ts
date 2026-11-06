function env(name: string): string | undefined {
  const value = process.env[name];
  return value === undefined || value === '' ? undefined : value;
}

function required(name: string): string {
  const value = env(name);
  if (value === undefined) throw new Error(`Missing environment variable ${name}`);
  return value;
}

function seconds(name: string, fallback: number): number {
  const value = env(name);
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`Invalid ${name}`);
  return parsed;
}

export type Config = {
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
  appPublicUrl: string;
  port: number;
  inviteTtlSeconds: number;
  knockTtlSeconds: number;
  presenceAwaySeconds: number;
  streamGraceSeconds: number;
  outboxRetrySeconds: number;
  idempotencyTtlSeconds: number;
  serverClockStart: string | undefined;
};

export const config: Config = {
  databaseUrl: required('DATABASE_URL'),
  smtpHost: required('SMTP_HOST'),
  smtpPort: Number(env('SMTP_PORT') ?? '1025'),
  mailFrom: required('MAIL_FROM'),
  killbillUrl: required('KILLBILL_URL'),
  killbillUsername: required('KILLBILL_USERNAME'),
  killbillPassword: required('KILLBILL_PASSWORD'),
  killbillApiKey: required('KILLBILL_API_KEY'),
  killbillApiSecret: required('KILLBILL_API_SECRET'),
  s3Endpoint: required('S3_ENDPOINT'),
  s3Region: env('S3_REGION') ?? 'us-east-1',
  s3Bucket: required('S3_BUCKET'),
  s3ForcePathStyle: (env('S3_FORCE_PATH_STYLE') ?? 'true') === 'true',
  s3AccessKeyId: required('S3_ACCESS_KEY_ID'),
  s3SecretAccessKey: required('S3_SECRET_ACCESS_KEY'),
  appPublicUrl: env('APP_PUBLIC_URL') ?? 'http://127.0.0.1:4173',
  port: Number(env('APP_PUBLIC_PORT') ?? '4173'),
  inviteTtlSeconds: seconds('INVITE_TTL_SECONDS', 604800),
  knockTtlSeconds: seconds('KNOCK_TTL_SECONDS', 60),
  presenceAwaySeconds: seconds('PRESENCE_AWAY_SECONDS', 600),
  streamGraceSeconds: seconds('STREAM_GRACE_SECONDS', 60),
  outboxRetrySeconds: seconds('OUTBOX_RETRY_SECONDS', 30),
  idempotencyTtlSeconds: seconds('IDEMPOTENCY_TTL_SECONDS', 86400),
  serverClockStart: env('SERVER_CLOCK_START'),
};
