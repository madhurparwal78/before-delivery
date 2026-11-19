export interface S3Config {
  endpoint: string;
  region: string;
  bucket: string;
  forcePathStyle: boolean;
  accessKeyId: string;
  secretAccessKey: string;
}

export interface SmtpConfig {
  host: string;
  port: number;
  from: string;
}

export interface ServerConfig {
  port: number;
  publicUrl: string;
  databaseUrl: string;
  s3: S3Config;
  smtp: SmtpConfig;
  gradingToken: string;
  timers: {
    autosaveMs: number;
    blocksStepMs: number;
    simTickMs: number;
    toastMs: number;
    glancetFadeMs: number;
  };
  joinRateLimit: number;
  verifyTtlSeconds: number;
}

function num(value: string | undefined, fallback: number): number {
  const n = value === undefined || value === '' ? NaN : parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

export function loadConfig(): ServerConfig {
  return {
    port: num(process.env.APP_PUBLIC_PORT, 4173),
    publicUrl: process.env.APP_PUBLIC_URL ?? 'http://127.0.0.1:4173',
    databaseUrl: process.env.DATABASE_URL ?? 'postgresql://localhost:5432/quarkyard',
    s3: {
      endpoint: process.env.S3_ENDPOINT ?? 'http://127.0.0.1:9000',
      region: process.env.S3_REGION ?? 'us-east-1',
      bucket: process.env.S3_BUCKET ?? 'quarkyard',
      forcePathStyle: (process.env.S3_FORCE_PATH_STYLE ?? 'true') === 'true',
      accessKeyId: process.env.S3_ACCESS_KEY_ID ?? '',
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? '',
    },
    smtp: {
      host: process.env.SMTP_HOST ?? '127.0.0.1',
      port: num(process.env.SMTP_PORT, 1025),
      from: process.env.MAIL_FROM ?? 'Hollowbrook Maker Co. <no-reply@hollowbrook.test>',
    },
    gradingToken: process.env.GRADING_TOKEN ?? 'qy-grading-local',
    timers: {
      autosaveMs: num(process.env.QY_AUTOSAVE_MS, 1500),
      blocksStepMs: num(process.env.QY_BLOCKS_STEP_MS, 400),
      simTickMs: num(process.env.QY_SIM_TICK_MS, 100),
      toastMs: num(process.env.QY_TOAST_MS, 4000),
      glancetFadeMs: num(process.env.QY_GLANCET_FADE_MS, 150),
    },
    joinRateLimit: num(process.env.QY_JOIN_RATE_LIMIT, 5),
    verifyTtlSeconds: num(process.env.QY_VERIFY_TTL_SECONDS, 86400),
  };
}
