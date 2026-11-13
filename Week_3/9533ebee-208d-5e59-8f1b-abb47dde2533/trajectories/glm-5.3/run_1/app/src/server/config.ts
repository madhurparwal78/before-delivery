// Configuration comes only from the environment. No literal fallback for any URL or credential.
import { problem } from './problems.js';

export interface Config {
  port: number;
  databaseUrl: string;
  s3: {
    endpoint: string;
    region: string;
    bucket: string;
    forcePathStyle: boolean;
    accessKeyId: string;
    secretAccessKey: string;
  };
  smtpHost: string;
  smtpPort: number;
  mailFrom: string;
  wiremockUrl: string;
  oraclePathPrefix: string;
  oraclePollSeconds: number;
  svixUrl: string;
  svixApiKey: string;
  gotenbergUrl: string;
  deskTimeZone: string;
  graceSeconds: number;
  stalenessSeconds: number;
  quoteTtlSeconds: number;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    console.error(`Missing required environment variable: ${name}`);
    process.exit(1);
  }
  return value;
}

function optionalEnv(name: string): string | undefined {
  const value = process.env[name];
  return value === undefined || value === '' ? undefined : value;
}

function parseSeconds(name: string, fallback: number): number {
  const raw = optionalEnv(name);
  if (raw === undefined) return fallback;
  if (!/^\d+$/.test(raw)) {
    console.error(`Invalid ${name}: ${raw}`);
    process.exit(1);
  }
  return Number.parseInt(raw, 10);
}

function parseTimeZone(raw: string | undefined): string {
  if (raw === undefined) return 'America/St_Johns';
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: raw }).format(new Date());
    return raw;
  } catch {
    console.error(`Invalid DESK_TIME_ZONE: ${raw}`);
    process.exit(1);
  }
}

let cached: Config | undefined;

export function getConfig(): Config {
  if (cached !== undefined) return cached;
  const portRaw = optionalEnv('APP_PUBLIC_PORT');
  cached = {
    port: portRaw !== undefined && /^\d+$/.test(portRaw) ? Number.parseInt(portRaw, 10) : 4173,
    databaseUrl: requireEnv('DATABASE_URL'),
    s3: {
      endpoint: requireEnv('S3_ENDPOINT'),
      region: requireEnv('S3_REGION'),
      bucket: requireEnv('S3_BUCKET'),
      forcePathStyle: (optionalEnv('S3_FORCE_PATH_STYLE') ?? 'true') === 'true',
      accessKeyId: requireEnv('S3_ACCESS_KEY_ID'),
      secretAccessKey: requireEnv('S3_SECRET_ACCESS_KEY'),
    },
    smtpHost: requireEnv('SMTP_HOST'),
    smtpPort: parsePort(optionalEnv('SMTP_PORT'), 1025),
    mailFrom: requireEnv('MAIL_FROM'),
    wiremockUrl: requireEnv('WIREMOCK_URL'),
    oraclePathPrefix: optionalEnv('ORACLE_PATH_PREFIX') ?? '',
    oraclePollSeconds: parseSeconds('ORACLE_POLL_SECONDS', 2),
    svixUrl: requireEnv('SVIX_URL'),
    svixApiKey: requireEnv('SVIX_API_KEY'),
    gotenbergUrl: requireEnv('GOTENBERG_URL'),
    deskTimeZone: parseTimeZone(optionalEnv('DESK_TIME_ZONE')),
    graceSeconds: parseSeconds('GRACE_SECONDS', 300),
    stalenessSeconds: parseSeconds('STALENESS_SECONDS', 3600),
    quoteTtlSeconds: parseSeconds('QUOTE_TTL_SECONDS', 30),
  };
  return cached;
}

function parsePort(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw === '' || !/^\d+$/.test(raw)) return fallback;
  return Number.parseInt(raw, 10);
}
