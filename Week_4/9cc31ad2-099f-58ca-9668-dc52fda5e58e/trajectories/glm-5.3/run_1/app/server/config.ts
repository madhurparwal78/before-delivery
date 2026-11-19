// Configuration read from the environment at start. Never sent to the browser.
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
  mail: {
    smtpHost: string;
    smtpPort: number;
    mailFrom: string;
  };
  publicUrl: string;
  port: number;
  gradingRoutes: boolean;
  verifyDelayMs: number;
  signinLinkTtlSeconds: number;
  rejoinSeconds: number;
  finishGraceSeconds: number;
}

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

export function loadConfig(): Config {
  const port = parseInt(process.env.APP_PUBLIC_PORT ?? '4173', 10);
  return {
    databaseUrl: process.env.DATABASE_URL ?? '',
    s3: {
      endpoint: process.env.S3_ENDPOINT ?? '',
      region: process.env.S3_REGION ?? 'us-east-1',
      bucket: process.env.S3_BUCKET ?? '',
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
      accessKeyId: process.env.S3_ACCESS_KEY_ID ?? '',
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? ''
    },
    mail: {
      smtpHost: process.env.SMTP_HOST ?? '',
      smtpPort: parseInt(process.env.SMTP_PORT ?? '25', 10),
      mailFrom: process.env.MAIL_FROM ?? 'Kerbline <laps@ochrekerb.example>'
    },
    publicUrl: process.env.APP_PUBLIC_URL ?? `http://localhost:${port}`,
    port,
    gradingRoutes: process.env.GRADING_ROUTES === 'on',
    verifyDelayMs: intEnv('VERIFY_DELAY_MS', 0),
    signinLinkTtlSeconds: intEnv('SIGNIN_LINK_TTL_SECONDS', 900),
    rejoinSeconds: intEnv('REJOIN_SECONDS', 30),
    finishGraceSeconds: intEnv('FINISH_GRACE_SECONDS', 60)
  };
}
