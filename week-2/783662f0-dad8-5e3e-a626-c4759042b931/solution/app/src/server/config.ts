/**
 * Configuration comes only from the environment. A missing service address,
 * credential, bucket, sender address, port or public base address stops the
 * start with an error naming the variable.
 */

/** The published default of every tunable duration, decided in this one place. */
const TUNABLE_DEFAULTS = {
  BILLING_GRACE_SECONDS: 172800,
  INVITE_TTL_SECONDS: 259200,
  WEATHER_PERIOD_SECONDS: 600,
  DAY_CYCLE_SECONDS: 86400,
} as const;

type TunableName = keyof typeof TUNABLE_DEFAULTS;

interface Config {
  readonly databaseUrl: string;
  readonly s3: {
    readonly endpoint: string;
    readonly region: string;
    readonly bucket: string;
    readonly forcePathStyle: boolean;
    readonly accessKeyId: string;
    readonly secretAccessKey: string;
  };
  readonly killbill: {
    readonly url: string;
    readonly username: string;
    readonly password: string;
    readonly apiKey: string;
    readonly apiSecret: string;
  };
  readonly smtp: { readonly host: string; readonly port: number };
  readonly mailFrom: string;
  readonly port: number;
  readonly publicBaseUrl: string;
  readonly publicOrigin: string;
  readonly billingGraceSeconds: number;
  readonly inviteTtlSeconds: number;
  readonly weatherPeriodSeconds: number;
  readonly dayCycleSeconds: number;
}

class ConfigError extends Error {}

function required(name: string): string {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') {
    throw new ConfigError(`Missing required environment variable: ${name}`);
  }
  return raw.trim();
}

function requiredPort(name: string): number {
  const raw = required(name);
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    throw new ConfigError(`Environment variable ${name} must be a port number, got ${raw}`);
  }
  return value;
}

function requiredBool(name: string): boolean {
  const raw = required(name).toLowerCase();
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  throw new ConfigError(`Environment variable ${name} must be true or false, got ${raw}`);
}

function tunable(name: TunableName): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return TUNABLE_DEFAULTS[name];
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new ConfigError(`Environment variable ${name} must be a positive number of seconds, got ${raw}`);
  }
  return value;
}

/** PUBLIC_BASE_URL, falling back to APP_PUBLIC_URL when it is unset. */
function publicBase(): string {
  const direct = process.env.PUBLIC_BASE_URL;
  const fallback = process.env.APP_PUBLIC_URL;
  const chosen =
    direct !== undefined && direct.trim() !== '' ? direct.trim() : (fallback ?? '').trim();
  if (chosen === '') {
    throw new ConfigError(
      'Missing required environment variable: PUBLIC_BASE_URL (or APP_PUBLIC_URL)',
    );
  }
  let parsed: URL;
  try {
    parsed = new URL(chosen);
  } catch {
    throw new ConfigError(
      `Environment variable PUBLIC_BASE_URL must be an absolute URL, got ${chosen}`,
    );
  }
  return parsed.origin + parsed.pathname.replace(/\/$/, '');
}

export function loadConfig(): Config {
  const base = publicBase();
  return {
    databaseUrl: required('DATABASE_URL'),
    s3: {
      endpoint: required('S3_ENDPOINT').replace(/\/$/, ''),
      region: required('S3_REGION'),
      bucket: required('S3_BUCKET'),
      forcePathStyle: requiredBool('S3_FORCE_PATH_STYLE'),
      accessKeyId: required('S3_ACCESS_KEY_ID'),
      secretAccessKey: required('S3_SECRET_ACCESS_KEY'),
    },
    killbill: {
      url: required('KILLBILL_URL').replace(/\/$/, ''),
      username: required('KILLBILL_USERNAME'),
      password: required('KILLBILL_PASSWORD'),
      apiKey: required('KILLBILL_API_KEY'),
      apiSecret: required('KILLBILL_API_SECRET'),
    },
    smtp: { host: required('SMTP_HOST'), port: requiredPort('SMTP_PORT') },
    mailFrom: required('MAIL_FROM'),
    port: requiredPort('APP_PUBLIC_PORT'),
    publicBaseUrl: base,
    publicOrigin: new URL(base).origin,
    billingGraceSeconds: tunable('BILLING_GRACE_SECONDS'),
    inviteTtlSeconds: tunable('INVITE_TTL_SECONDS'),
    weatherPeriodSeconds: tunable('WEATHER_PERIOD_SECONDS'),
    dayCycleSeconds: tunable('DAY_CYCLE_SECONDS'),
  };
}

let active: Config | null = null;

export function config(): Config {
  if (active === null) active = loadConfig();
  return active;
}
