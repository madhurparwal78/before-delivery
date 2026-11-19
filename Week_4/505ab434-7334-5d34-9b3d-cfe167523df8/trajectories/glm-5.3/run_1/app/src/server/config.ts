import * as crypto from 'node:crypto';

function str(name: string, def?: string): string | undefined {
  const v = process.env[name];
  return v === undefined || v === '' ? def : v;
}
function int(name: string, def: number): number {
  const v = str(name);
  if (v === undefined) return def;
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}
function need(name: string): string {
  const v = str(name);
  if (v === undefined) throw new Error(`Missing required environment variable ${name}`);
  return v;
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
  smtp: { host: string; port: number; from: string };
  appPublicPort: number;
  appPublicUrl: string;
  gradingKey: string | undefined;
  appStartAt: string;
  appTimeZone: string;
  downloadLinkTtlSeconds: number;
  deadlineHoursStandard: number;
  deadlineHoursExtended: number;
  deadlineHoursLegal: number;
  deadlineWarningPercent: number;
  expiryCeilingMultiplier: number;
  proofMaxBytes: number;
  weightAnnounceDelayMs: number;
  submitDedupSeconds: number;
  inviteTtlHours: number;
  sessionCookieName: string;
  linkSigningSecret: string;
}

export function loadConfig(): Config {
  return {
    databaseUrl: need('DATABASE_URL'),
    s3: {
      endpoint: need('S3_ENDPOINT'),
      region: str('S3_REGION', 'us-east-1')!,
      bucket: need('S3_BUCKET'),
      forcePathStyle: str('S3_FORCE_PATH_STYLE', 'true') !== 'false',
      accessKeyId: need('S3_ACCESS_KEY_ID'),
      secretAccessKey: need('S3_SECRET_ACCESS_KEY'),
    },
    smtp: { host: need('SMTP_HOST'), port: int('SMTP_PORT', 1025), from: need('MAIL_FROM') },
    appPublicPort: int('APP_PUBLIC_PORT', 4173),
    appPublicUrl: str('APP_PUBLIC_URL', `http://127.0.0.1:${int('APP_PUBLIC_PORT', 4173)}`)!,
    gradingKey: str('GRADING_KEY'),
    appStartAt: str('APP_START_AT', '2026-03-02T09:00:00+01:00')!,
    appTimeZone: str('APP_TIME_ZONE', 'Europe/Berlin')!,
    downloadLinkTtlSeconds: int('DOWNLOAD_LINK_TTL_SECONDS', 300),
    deadlineHoursStandard: int('DEADLINE_HOURS_STANDARD', 24),
    deadlineHoursExtended: int('DEADLINE_HOURS_EXTENDED', 48),
    deadlineHoursLegal: int('DEADLINE_HOURS_LEGAL', 72),
    deadlineWarningPercent: int('DEADLINE_WARNING_PERCENT', 75),
    expiryCeilingMultiplier: int('EXPIRY_CEILING_MULTIPLIER', 2),
    proofMaxBytes: int('PROOF_MAX_BYTES', 5242880),
    weightAnnounceDelayMs: int('WEIGHT_ANNOUNCE_DELAY_MS', 300),
    submitDedupSeconds: int('SUBMIT_DEDUP_SECONDS', 10),
    inviteTtlHours: int('INVITE_TTL_HOURS', 72),
    sessionCookieName: str('SESSION_COOKIE_NAME', 'rulehouse_session')!,
    linkSigningSecret: str('LINK_SIGNING_SECRET') ?? crypto.randomBytes(32).toString('hex'),
  };
}

export function publicOrigin(cfg: Config): string {
  try {
    return new URL(cfg.appPublicUrl).origin;
  } catch {
    return `http://127.0.0.1:${cfg.appPublicPort}`;
  }
}
