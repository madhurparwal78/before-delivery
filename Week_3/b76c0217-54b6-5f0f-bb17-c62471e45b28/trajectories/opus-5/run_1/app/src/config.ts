function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value;
}

function millis(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Environment variable ${name} must be a positive number of milliseconds`);
  }
  return Math.floor(value);
}

export interface Config {
  port: number;
  databaseUrl: string;
  storage: {
    endpoint: string;
    region: string;
    bucket: string;
    forcePathStyle: boolean;
    accessKeyId: string;
    secretAccessKey: string;
  };
  mail: {
    host: string;
    port: number;
    from: string;
  };
  appPublicUrl: string;
  gradingRoutes: boolean;
  inviteTtlMs: number;
  mailRetryMs: number;
  previewLinkTtlMs: number;
  presenceTimeoutMs: number;
}

export const config: Config = {
  port: Number(process.env.APP_PUBLIC_PORT ?? 4173),
  databaseUrl: required('DATABASE_URL'),
  storage: {
    endpoint: required('S3_ENDPOINT'),
    region: required('S3_REGION'),
    bucket: required('S3_BUCKET'),
    forcePathStyle: required('S3_FORCE_PATH_STYLE') === 'true',
    accessKeyId: required('S3_ACCESS_KEY_ID'),
    secretAccessKey: required('S3_SECRET_ACCESS_KEY'),
  },
  mail: {
    host: required('SMTP_HOST'),
    port: Number(required('SMTP_PORT')),
    from: required('MAIL_FROM'),
  },
  appPublicUrl: required('APP_PUBLIC_URL'),
  gradingRoutes: process.env.GRADING_ROUTES === 'on',
  inviteTtlMs: millis('INVITE_TTL_MS', 604800000),
  mailRetryMs: millis('MAIL_RETRY_MS', 60000),
  previewLinkTtlMs: millis('PREVIEW_LINK_TTL_MS', 259200000),
  presenceTimeoutMs: millis('PRESENCE_TIMEOUT_MS', 30000),
};
