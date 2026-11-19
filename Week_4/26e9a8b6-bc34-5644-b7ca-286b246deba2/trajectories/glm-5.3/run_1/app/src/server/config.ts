// Service credentials and platform settings, read from the environment at start.

import { limitsFromEnv, type Limits } from '../shared/limits';

export interface Config {
  port: number;
  publicUrl: string;
  databaseUrl: string;
  s3: {
    endpoint: string;
    region: string;
    bucket: string;
    forcePathStyle: boolean;
    accessKeyId: string;
    secretAccessKey: string;
  };
  smtp: {
    host: string;
    port: number;
    mailFrom: string;
  };
  gradingRoutes: boolean;
  limits: Limits;
}

export function readConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const port = Number.parseInt(env.APP_PUBLIC_PORT ?? '4173', 10) || 4173;
  return {
    port,
    publicUrl: env.APP_PUBLIC_URL ?? `http://127.0.0.1:${port}`,
    databaseUrl: env.DATABASE_URL ?? 'postgresql://localhost:5432/pennywasher',
    s3: {
      endpoint: env.S3_ENDPOINT ?? 'http://127.0.0.1:9000',
      region: env.S3_REGION ?? 'us-east-1',
      bucket: env.S3_BUCKET ?? 'pennywasher',
      forcePathStyle: env.S3_FORCE_PATH_STYLE === 'true',
      accessKeyId: env.S3_ACCESS_KEY_ID ?? '',
      secretAccessKey: env.S3_SECRET_ACCESS_KEY ?? '',
    },
    smtp: {
      host: env.SMTP_HOST ?? '127.0.0.1',
      port: Number.parseInt(env.SMTP_PORT ?? '1025', 10) || 1025,
      mailFrom: env.MAIL_FROM ?? 'Pennywasher Works <no-reply@pennywasher.example>',
    },
    gradingRoutes: env.GRADING_ROUTES === 'on',
    limits: limitsFromEnv(env),
  };
}
