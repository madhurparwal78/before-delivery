/* Central configuration: every URL, credential, timer and limit is read from
   the environment at start. Nothing is logged in full or sent to the browser. */
import { S3Client } from '@aws-sdk/client-s3';
import pg from 'pg';
import nodemailer from 'nodemailer';

export type AppConfig = {
  port: number;
  publicUrl: string;
  gradingKey: string | null;
  databaseUrl: string;
  s3: {
    endpoint: string;
    region: string;
    bucket: string;
    forcePathStyle: boolean;
    accessKeyId: string;
    secretAccessKey: string;
  };
  valkeyUrl: string;
  valkeyKeyPrefix: string;
  smtp: { host: string; port: number; from: string };
  limits: {
    voteRate: number;
    postRate: number;
    loginLockoutAttempts: number;
    loginLockoutSeconds: number;
    verifyTtl: number;
    verifyResendLimit: number;
    verifyResendWindow: number;
    resetTtl: number;
    reportDeadline: number;
    archiveAfterDays: number;
    communityMinAccountAgeDays: number;
    commentEditWindow: number;
    lockHourSeconds: number;
    mod2faThreshold: number;
    maxImageBytes: number;
  };
};

function num(name: string, dflt: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return dflt;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : dflt;
}

function str(name: string, dflt: string): string {
  const raw = process.env[name];
  return raw !== undefined && raw !== '' ? raw : dflt;
}

export function loadConfig(): AppConfig {
  const port = num('APP_PUBLIC_PORT', 443);
  const publicUrl = str('APP_PUBLIC_URL', `http://localhost:${port}`).replace(/\/+$/, '');
  return {
    port,
    publicUrl,
    gradingKey: process.env.GRADING_KEY && process.env.GRADING_KEY !== '' ? process.env.GRADING_KEY : null,
    databaseUrl: str('DATABASE_URL', 'postgresql://localhost:5432/moothall'),
    s3: {
      endpoint: str('S3_ENDPOINT', 'http://127.0.0.1:9000'),
      region: str('S3_REGION', 'us-east-1'),
      bucket: str('S3_BUCKET', 'moothall'),
      forcePathStyle: str('S3_FORCE_PATH_STYLE', 'true') === 'true',
      accessKeyId: str('S3_ACCESS_KEY_ID', ''),
      secretAccessKey: str('S3_SECRET_ACCESS_KEY', ''),
    },
    valkeyUrl: str('VALKEY_URL', 'redis://127.0.0.1:6379/0'),
    valkeyKeyPrefix: str('VALKEY_KEY_PREFIX', 'mh:'),
    smtp: { host: str('SMTP_HOST', '127.0.0.1'), port: num('SMTP_PORT', 1025), from: str('MAIL_FROM', 'Moothall <no-reply@moothall.test>') },
    limits: {
      voteRate: num('VOTE_RATE_LIMIT', 60),
      postRate: num('POST_RATE_LIMIT', 20),
      loginLockoutAttempts: num('LOGIN_LOCKOUT_ATTEMPTS', 5),
      loginLockoutSeconds: num('LOGIN_LOCKOUT_SECONDS', 900),
      verifyTtl: num('VERIFY_LINK_TTL_SECONDS', 86400),
      verifyResendLimit: num('VERIFY_RESEND_LIMIT', 3),
      verifyResendWindow: num('VERIFY_RESEND_WINDOW_SECONDS', 3600),
      resetTtl: num('RESET_LINK_TTL_SECONDS', 1800),
      reportDeadline: num('REPORT_DEADLINE_SECONDS', 86400),
      archiveAfterDays: num('ARCHIVE_AFTER_DAYS', 183),
      communityMinAccountAgeDays: num('COMMUNITY_MIN_ACCOUNT_AGE_DAYS', 7),
      commentEditWindow: num('COMMENT_EDIT_WINDOW_SECONDS', 900),
      lockHourSeconds: num('LOCK_HOUR_SECONDS', 3600),
      mod2faThreshold: num('MOD_2FA_MEMBER_THRESHOLD', 1000),
      maxImageBytes: num('MAX_IMAGE_BYTES', 20000000),
    },
  };
}

export function makeDb(): pg.Client {
  return new pg.Client({ connectionString: loadConfig().databaseUrl });
}

export function makeStorage(cfg: AppConfig): S3Client {
  return new S3Client({
    endpoint: cfg.s3.endpoint,
    region: cfg.s3.region,
    forcePathStyle: cfg.s3.forcePathStyle,
    credentials: { accessKeyId: cfg.s3.accessKeyId, secretAccessKey: cfg.s3.secretAccessKey },
  });
}

export function makeMailTransport(cfg: AppConfig): nodemailer.Transporter {
  return nodemailer.createTransport({
    host: cfg.smtp.host,
    port: cfg.smtp.port,
    secure: false,
    ignoreTLS: true,
    connectionTimeout: 4000,
    greetingTimeout: 4000,
    socketTimeout: 6000,
  });
}
