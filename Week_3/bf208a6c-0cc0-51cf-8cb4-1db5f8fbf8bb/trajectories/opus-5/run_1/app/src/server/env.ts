import { createHash } from 'node:crypto';

const required = (name: string): string => {
  const value = process.env[name];
  if (value === undefined || value === '') throw new Error(`Missing environment variable ${name}`);
  return value;
};

const optional = (name: string): string | null => {
  const value = process.env[name];
  return value === undefined || value === '' ? null : value;
};

const number = (name: string, fallback: number): number => {
  const value = process.env[name];
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`Environment variable ${name} is not a number`);
  return parsed;
};

export const env = {
  databaseUrl: required('DATABASE_URL'),
  s3: {
    endpoint: required('S3_ENDPOINT'),
    region: required('S3_REGION'),
    bucket: required('S3_BUCKET'),
    forcePathStyle: required('S3_FORCE_PATH_STYLE') === 'true',
    accessKeyId: required('S3_ACCESS_KEY_ID'),
    secretAccessKey: required('S3_SECRET_ACCESS_KEY'),
  },
  smtp: {
    host: required('SMTP_HOST'),
    port: number('SMTP_PORT', 1025),
    from: required('MAIL_FROM'),
  },
  ntfy: {
    url: required('NTFY_URL'),
    username: required('NTFY_USERNAME'),
    password: required('NTFY_PASSWORD'),
  },
  port: number('APP_PUBLIC_PORT', 4173),
  publicUrl: required('APP_PUBLIC_URL').replace(/\/+$/, ''),
  gradingKey: optional('GRADING_KEY'),
  uploadMaxBytes: number('UPLOAD_MAX_BYTES', 5000000),
  verifyCodeTtlSeconds: number('VERIFY_CODE_TTL_SECONDS', 900),
  inviteTtlSeconds: number('INVITE_TTL_SECONDS', 604800),
} as const;

export const jsonBodyLimit = 64000;
export const multipartBodyLimit = env.uploadMaxBytes + 64000;

export const cookieSecret = createHash('sha256')
  .update(`${env.databaseUrl}\n${env.s3.secretAccessKey}\n${env.ntfy.password}`)
  .digest();
