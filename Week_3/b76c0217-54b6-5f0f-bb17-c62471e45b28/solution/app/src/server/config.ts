// The only module that reads process.env. Every value is read once, at start.

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`${name} is not set`);
  }
  return value;
}

function port(name: string): number {
  const parsed = Number(required(name));
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error(`${name} must be a port number`);
  }
  return parsed;
}

function milliseconds(name: string, documentedDefault: number): number {
  const value = process.env[name];
  if (value === undefined || value === '') {
    return documentedDefault;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${name} must be a whole number of milliseconds`);
  }
  return parsed;
}

export const config = {
  port: milliseconds('APP_PUBLIC_PORT', 4173),
  publicUrl: required('APP_PUBLIC_URL').replace(/\/+$/, ''),
  gradingRoutes: process.env.GRADING_ROUTES === 'on',
  databaseUrl: required('DATABASE_URL'),
  s3: {
    endpoint: required('S3_ENDPOINT').replace(/\/+$/, ''),
    region: required('S3_REGION'),
    bucket: required('S3_BUCKET'),
    forcePathStyle: required('S3_FORCE_PATH_STYLE') === 'true',
    accessKeyId: required('S3_ACCESS_KEY_ID'),
    secretAccessKey: required('S3_SECRET_ACCESS_KEY'),
  },
  smtp: {
    host: required('SMTP_HOST'),
    port: port('SMTP_PORT'),
    from: required('MAIL_FROM'),
    // read at start like every documented setting; delivery itself goes over SMTP
    mailpitUrl: required('MAILPIT_URL'),
  },
  inviteTtlMs: milliseconds('INVITE_TTL_MS', 604_800_000),
  mailRetryMs: milliseconds('MAIL_RETRY_MS', 60_000),
  previewLinkTtlMs: milliseconds('PREVIEW_LINK_TTL_MS', 259_200_000),
  presenceTimeoutMs: milliseconds('PRESENCE_TIMEOUT_MS', 30_000),
};
