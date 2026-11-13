// Every service URL, credential and desk setting is read from the environment at start.
export interface DeskConfig {
  databaseUrl: string;
  s3: {
    endpoint: string;
    region: string;
    bucket: string;
    forcePathStyle: boolean;
    accessKeyId: string;
    secretAccessKey: string;
  };
  killbill: {
    url: string;
    username: string;
    password: string;
    apiKey: string;
    apiSecret: string;
  };
  smtp: { host: string; port: number };
  mailpitUrl: string;
  mailFrom: string;
  wiremockUrl: string;
  appPublicUrl: string;
  appPublicPort: number;
  aftercareStandardMonths: number;
  aftercareClubMonths: number;
  aftercareTermSecondsOverride: number | null;
  confirmLinkTtlSeconds: number;
  dispatchCutoffLocal: string;
  referenceLockSeconds: number;
  partsRateLimitPerMinute: number;
  operatorSessionSeconds: number;
  deskClockFrozenAt: string | null;
}

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return parsed;
}

function numOrNull(name: string): number | null {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return null;
  return parsed;
}

function str(name: string, fallback: string): string {
  const raw = process.env[name];
  return raw === undefined || raw === '' ? fallback : raw;
}

export function loadConfig(): DeskConfig {
  const portEnv = process.env['APP_PUBLIC_PORT'];
  const port = portEnv !== undefined && portEnv !== '' ? Number(portEnv) : 4173;
  return {
    databaseUrl: str('DATABASE_URL', 'postgresql://localhost:5432/gf_dev'),
    s3: {
      endpoint: str('S3_ENDPOINT', 'http://localhost:9000'),
      region: str('S3_REGION', 'us-east-1'),
      bucket: str('S3_BUCKET', 'gf-dev'),
      forcePathStyle: str('S3_FORCE_PATH_STYLE', 'true') === 'true',
      accessKeyId: str('S3_ACCESS_KEY_ID', ''),
      secretAccessKey: str('S3_SECRET_ACCESS_KEY', ''),
    },
    killbill: {
      url: str('KILLBILL_URL', 'http://localhost:8080'),
      username: str('KILLBILL_USERNAME', 'admin'),
      password: str('KILLBILL_PASSWORD', 'password'),
      apiKey: str('KILLBILL_API_KEY', ''),
      apiSecret: str('KILLBILL_API_SECRET', ''),
    },
    smtp: { host: str('SMTP_HOST', 'localhost'), port: num('SMTP_PORT', 1025) },
    mailpitUrl: str('MAILPIT_URL', 'http://localhost:8025'),
    mailFrom: str('MAIL_FROM', 'Holmgarth Aftercare <desk@holmgarth.example>'),
    wiremockUrl: str('WIREMOCK_URL', 'http://localhost:8080'),
    appPublicUrl: str('APP_PUBLIC_URL', `http://localhost:${port}`),
    appPublicPort: port,
    aftercareStandardMonths: num('AFTERCARE_STANDARD_MONTHS', 24),
    aftercareClubMonths: num('AFTERCARE_CLUB_MONTHS', 36),
    aftercareTermSecondsOverride: numOrNull('AFTERCARE_TERM_SECONDS_OVERRIDE'),
    confirmLinkTtlSeconds: num('CONFIRM_LINK_TTL_SECONDS', 1800),
    dispatchCutoffLocal: str('DISPATCH_CUTOFF_LOCAL', '14:00'),
    referenceLockSeconds: num('REFERENCE_LOCK_SECONDS', 900),
    partsRateLimitPerMinute: num('PARTS_RATE_LIMIT_PER_MINUTE', 60),
    operatorSessionSeconds: num('OPERATOR_SESSION_SECONDS', 43200),
    deskClockFrozenAt: process.env['DESK_CLOCK_FROZEN_AT'] || null,
  };
}
