function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value;
}

function optional(name: string): string | undefined {
  const value = process.env[name];
  return value === undefined || value === '' ? undefined : value;
}

const port = Number(optional('APP_PUBLIC_PORT') ?? '4173');
const publishDelayRaw = optional('PREVIEW_PUBLISH_DELAY_SECONDS');

export const config = {
  port,
  publicUrl: optional('APP_PUBLIC_URL') ?? `http://localhost:${port}`,
  databaseUrl: required('DATABASE_URL'),
  s3: {
    endpoint: required('S3_ENDPOINT'),
    region: optional('S3_REGION') ?? 'us-east-1',
    bucket: required('S3_BUCKET'),
    forcePathStyle: (optional('S3_FORCE_PATH_STYLE') ?? 'true') === 'true',
    accessKeyId: required('S3_ACCESS_KEY_ID'),
    secretAccessKey: required('S3_SECRET_ACCESS_KEY'),
  },
  mail: {
    host: required('SMTP_HOST'),
    port: Number(required('SMTP_PORT')),
    from: required('MAIL_FROM'),
  },
  previewPublishDelaySeconds:
    publishDelayRaw === undefined ? null : Number.parseInt(publishDelayRaw, 10),
  maxJsonBytes: 65536,
  maxPhotoBytes: 10_000_000,
} as const;

export const JSON_CONTENT_TYPE = 'application/json; charset=utf-8';
