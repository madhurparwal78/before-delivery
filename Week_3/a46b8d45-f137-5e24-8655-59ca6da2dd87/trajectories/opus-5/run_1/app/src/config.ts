/**
 * Every service address, credential and desk setting is read from the environment once at
 * start. A setting of `0` is a real value and is never replaced by its default.
 */

function text(name: string, fallback: string): string {
  const raw = process.env[name];
  return raw === undefined || raw === '' ? fallback : raw;
}

function optionalText(name: string): string | null {
  const raw = process.env[name];
  return raw === undefined || raw === '' ? null : raw;
}

function whole(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a whole number of 0 or more`);
  }
  return value;
}

function optionalWhole(name: string): number | null {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return null;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a whole number of 0 or more`);
  }
  return value;
}

function flag(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  return raw === 'true' || raw === '1';
}

/** `HH:MM` on the Europe/London clock. */
function localTime(name: string, fallback: string): { hour: number; minute: number } {
  const raw = text(name, fallback);
  const match = /^(\d{2}):(\d{2})$/.exec(raw);
  if (!match) throw new Error(`${name} must be HH:MM`);
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) throw new Error(`${name} must be a real time of day`);
  return { hour, minute };
}

const port = whole('APP_PUBLIC_PORT', 4173);

export const config = {
  port,
  publicUrl: (optionalText('APP_PUBLIC_URL') ?? `http://localhost:${port}`).replace(/\/+$/, ''),

  databaseUrl: text('DATABASE_URL', ''),

  s3: {
    endpoint: text('S3_ENDPOINT', '').replace(/\/+$/, ''),
    region: text('S3_REGION', 'us-east-1'),
    bucket: text('S3_BUCKET', ''),
    forcePathStyle: flag('S3_FORCE_PATH_STYLE', true),
    accessKeyId: text('S3_ACCESS_KEY_ID', ''),
    secretAccessKey: text('S3_SECRET_ACCESS_KEY', ''),
  },

  killbill: {
    url: text('KILLBILL_URL', '').replace(/\/+$/, ''),
    username: text('KILLBILL_USERNAME', ''),
    password: text('KILLBILL_PASSWORD', ''),
    apiKey: text('KILLBILL_API_KEY', ''),
    apiSecret: text('KILLBILL_API_SECRET', ''),
  },

  mail: {
    host: text('SMTP_HOST', ''),
    port: whole('SMTP_PORT', 1025),
    mailpitUrl: text('MAILPIT_URL', '').replace(/\/+$/, ''),
    from: text('MAIL_FROM', 'Holmgarth Aftercare <desk@holmgarth.example>'),
  },

  carrierUrl: text('WIREMOCK_URL', '').replace(/\/+$/, ''),

  aftercareStandardMonths: whole('AFTERCARE_STANDARD_MONTHS', 24),
  aftercareClubMonths: whole('AFTERCARE_CLUB_MONTHS', 36),
  aftercareTermSecondsOverride: optionalWhole('AFTERCARE_TERM_SECONDS_OVERRIDE'),
  confirmLinkTtlSeconds: whole('CONFIRM_LINK_TTL_SECONDS', 1800),
  dispatchCutoffLocal: localTime('DISPATCH_CUTOFF_LOCAL', '14:00'),
  referenceLockSeconds: whole('REFERENCE_LOCK_SECONDS', 900),
  partsRateLimitPerMinute: whole('PARTS_RATE_LIMIT_PER_MINUTE', 60),
  operatorSessionSeconds: whole('OPERATOR_SESSION_SECONDS', 43200),
  deskClockFrozenAt: optionalText('DESK_CLOCK_FROZEN_AT'),
} as const;
