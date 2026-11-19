function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') throw new Error(`missing environment variable ${name}`);
  return value;
}

function optional(name: string, fallback: string): string {
  const value = process.env[name];
  return value === undefined || value === '' ? fallback : value;
}

function integer(name: string, fallback: number): number {
  const value = process.env[name];
  if (value === undefined || value === '') return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) throw new Error(`environment variable ${name} is not a number`);
  return parsed;
}

export interface Config {
  databaseUrl: string;
  s3: {
    endpoint: string;
    region: string;
    bucket: string;
    forcePathStyle: boolean;
    accessKeyId: string;
    secretAccessKey: string;
  };
  mail: { host: string; port: number; from: string };
  port: number;
  publicUrl: string;
  gradingRoutes: boolean;
  verifyDelayMs: number;
  signinLinkTtlSeconds: number;
  rejoinSeconds: number;
  finishGraceSeconds: number;
}

export function loadConfig(): Config {
  const port = integer('APP_PUBLIC_PORT', 4173);
  return {
    databaseUrl: required('DATABASE_URL'),
    s3: {
      endpoint: required('S3_ENDPOINT'),
      region: optional('S3_REGION', 'us-east-1'),
      bucket: required('S3_BUCKET'),
      forcePathStyle: optional('S3_FORCE_PATH_STYLE', 'true') === 'true',
      accessKeyId: required('S3_ACCESS_KEY_ID'),
      secretAccessKey: required('S3_SECRET_ACCESS_KEY'),
    },
    mail: {
      host: required('SMTP_HOST'),
      port: integer('SMTP_PORT', 1025),
      from: optional('MAIL_FROM', 'Kerbline <laps@ochrekerb.example>'),
    },
    port,
    publicUrl: optional('APP_PUBLIC_URL', `http://localhost:${port}`),
    gradingRoutes: process.env.GRADING_ROUTES === 'on',
    verifyDelayMs: integer('VERIFY_DELAY_MS', 0),
    signinLinkTtlSeconds: integer('SIGNIN_LINK_TTL_SECONDS', 900),
    rejoinSeconds: integer('REJOIN_SECONDS', 30),
    finishGraceSeconds: integer('FINISH_GRACE_SECONDS', 60),
  };
}

export const config = loadConfig();
