export type SeedSet = 'site-day' | 'pack-expiry' | null;

export interface Config {
  databaseUrl: string;
  killbill: {
    url: string;
    username: string;
    password: string;
    apiKey: string;
    apiSecret: string;
  };
  s3: {
    endpoint: string;
    region: string;
    bucket: string;
    forcePathStyle: boolean;
    accessKeyId: string;
    secretAccessKey: string;
  };
  smtp: { host: string; port: number; mailFrom: string };
  port: number;
  holdTtlSeconds: number;
  inspectorLinkTtlSeconds: number;
  sessionIdleSeconds: number;
  sessionAbsoluteSeconds: number;
  signInThrottleWindowSeconds: number;
  clockStart: string | null;
  seedSet: SeedSet;
}

function str(name: string, fallback = ''): string {
  const raw = process.env[name];
  return raw === undefined || raw === '' ? fallback : raw;
}

function int(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Environment variable ${name} must be a positive integer`);
  }
  return value;
}

function readSeedSet(): SeedSet {
  const raw = process.env.PILOTLIGHT_SEED_SET;
  if (raw === undefined || raw === '') return null;
  if (raw === 'site-day' || raw === 'pack-expiry') return raw;
  throw new Error(
    `Environment variable PILOTLIGHT_SEED_SET must be "site-day" or "pack-expiry", not "${raw}"`,
  );
}

function readClockStart(): string | null {
  const raw = process.env.PILOTLIGHT_CLOCK_START;
  if (raw === undefined || raw === '') return null;
  const parsed = Date.parse(raw);
  if (Number.isNaN(parsed)) {
    throw new Error('Environment variable PILOTLIGHT_CLOCK_START must be an ISO-8601 UTC instant');
  }
  return raw;
}

export const config: Config = {
  databaseUrl: str('DATABASE_URL'),
  killbill: {
    url: str('KILLBILL_URL'),
    username: str('KILLBILL_USERNAME'),
    password: str('KILLBILL_PASSWORD'),
    apiKey: str('KILLBILL_API_KEY'),
    apiSecret: str('KILLBILL_API_SECRET'),
  },
  s3: {
    endpoint: str('S3_ENDPOINT'),
    region: str('S3_REGION', 'us-east-1'),
    bucket: str('S3_BUCKET'),
    forcePathStyle: str('S3_FORCE_PATH_STYLE', 'true') === 'true',
    accessKeyId: str('S3_ACCESS_KEY_ID'),
    secretAccessKey: str('S3_SECRET_ACCESS_KEY'),
  },
  smtp: {
    host: str('SMTP_HOST'),
    port: int('SMTP_PORT', 1025),
    mailFrom: str('MAIL_FROM', 'Pilotlight <tickets@pilotlight.example>'),
  },
  port: int('APP_PUBLIC_PORT', 4173),
  holdTtlSeconds: int('HOLD_TTL_SECONDS', 600),
  inspectorLinkTtlSeconds: int('INSPECTOR_LINK_TTL_SECONDS', 259200),
  sessionIdleSeconds: int('SESSION_IDLE_SECONDS', 1800),
  sessionAbsoluteSeconds: int('SESSION_ABSOLUTE_SECONDS', 43200),
  signInThrottleWindowSeconds: int('SIGN_IN_THROTTLE_WINDOW_SECONDS', 900),
  clockStart: readClockStart(),
  seedSet: readSeedSet(),
};
