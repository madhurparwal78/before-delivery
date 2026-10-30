function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value;
}

function optional(name: string, fallback: string): string {
  const value = process.env[name];
  return value === undefined || value === '' ? fallback : value;
}

function seconds(name: string, fallback: number): number {
  const value = process.env[name];
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Environment variable ${name} must be a positive number of seconds`);
  }
  return parsed;
}

const port = Number(optional('APP_PUBLIC_PORT', '4173'));

export const config = {
  port,
  publicUrl: optional('APP_PUBLIC_URL', `http://localhost:${port}`).replace(/\/+$/, ''),
  databaseUrl: required('DATABASE_URL'),
  s3: {
    endpoint: required('S3_ENDPOINT').replace(/\/+$/, ''),
    region: required('S3_REGION'),
    bucket: required('S3_BUCKET'),
    forcePathStyle: optional('S3_FORCE_PATH_STYLE', 'true') === 'true',
    accessKeyId: required('S3_ACCESS_KEY_ID'),
    secretAccessKey: required('S3_SECRET_ACCESS_KEY'),
  },
  smtp: {
    host: required('SMTP_HOST'),
    port: Number(required('SMTP_PORT')),
    from: required('MAIL_FROM'),
  },
  magicLinkTtlSeconds: seconds('MAGIC_LINK_TTL_SECONDS', 900),
  reviewerLinkHourSeconds: seconds('REVIEWER_LINK_HOUR_SECONDS', 3600),
  checkpointUploadDeadlineSeconds: seconds('CHECKPOINT_UPLOAD_DEADLINE_SECONDS', 86400),
  importPlanTtlSeconds: seconds('IMPORT_PLAN_TTL_SECONDS', 3600),
} as const;

export const limits = {
  jsonBytes: 2_000_000,
  zipBytes: 5_000_000,
  socketFrameBytes: 2_000_000,
  fileContentBytes: 1_000_000,
  zipEntries: 500,
  zipFileBytes: 1_000_000,
  zipTotalBytes: 20_000_000,
  zipRatio: 100,
  zipRatioFloorBytes: 10_000,
  pathChars: 255,
  nameChars: 80,
} as const;
