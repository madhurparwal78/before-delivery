/**
 * Every service URL and credential is read here, from the environment only.
 * No service URL or credential has a literal fallback. A missing or invalid
 * required variable exits non-zero with a message naming the variable.
 */

export interface Config {
  readonly databaseUrl: string;
  readonly s3: {
    readonly endpoint: string;
    readonly region: string;
    readonly bucket: string;
    readonly forcePathStyle: boolean;
    readonly accessKeyId: string;
    readonly secretAccessKey: string;
  };
  readonly smtpHost: string;
  readonly smtpPort: number;
  readonly mailFrom: string;
  readonly wiremockUrl: string;
  readonly oraclePathPrefix: string;
  readonly oraclePollSeconds: number;
  readonly svixUrl: string;
  readonly svixApiKey: string;
  readonly gotenbergUrl: string;
  readonly deskTimeZone: string;
  readonly graceSeconds: number;
  readonly stalenessSeconds: number;
  readonly quoteTtlSeconds: number;
  readonly port: number;
}

class ConfigError extends Error {}

function required(name: string): string {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') {
    throw new ConfigError(`Required environment variable ${name} is missing.`);
  }
  return raw.trim();
}

function optional(name: string, fallback: string): string {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  return raw;
}

function positiveSeconds(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  if (!/^[0-9]+$/.test(raw.trim())) {
    throw new ConfigError(`Environment variable ${name} must be a whole number of seconds.`);
  }
  const value = Number(raw.trim());
  if (value <= 0) {
    throw new ConfigError(
      `Environment variable ${name} must be a whole number of seconds above zero.`,
    );
  }
  return value;
}

function port(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  if (!/^[0-9]+$/.test(raw.trim())) {
    throw new ConfigError(`Environment variable ${name} must be a port number.`);
  }
  const value = Number(raw.trim());
  if (value < 1 || value > 65535) {
    throw new ConfigError(
      `Environment variable ${name} must be a port number from 1 to 65535.`,
    );
  }
  return value;
}

function timeZone(name: string, fallback: string): string {
  const raw = process.env[name];
  const zone = raw === undefined || raw.trim() === '' ? fallback : raw.trim();
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: zone });
  } catch {
    throw new ConfigError(`Environment variable ${name} must be an IANA time zone name.`);
  }
  return zone;
}

function boolean(name: string): boolean {
  const raw = required(name).toLowerCase();
  if (raw !== 'true' && raw !== 'false') {
    throw new ConfigError(`Environment variable ${name} must be true or false.`);
  }
  return raw === 'true';
}

function readConfig(): Config {
  const smtpPortRaw = required('SMTP_PORT');
  if (!/^[0-9]+$/.test(smtpPortRaw)) {
    throw new ConfigError('Environment variable SMTP_PORT must be a port number.');
  }
  const prefix = optional('ORACLE_PATH_PREFIX', '').trim();
  return {
    databaseUrl: required('DATABASE_URL'),
    s3: {
      endpoint: required('S3_ENDPOINT').replace(/\/+$/, ''),
      region: required('S3_REGION'),
      bucket: required('S3_BUCKET'),
      forcePathStyle: boolean('S3_FORCE_PATH_STYLE'),
      accessKeyId: required('S3_ACCESS_KEY_ID'),
      secretAccessKey: required('S3_SECRET_ACCESS_KEY'),
    },
    smtpHost: required('SMTP_HOST'),
    smtpPort: Number(smtpPortRaw),
    mailFrom: required('MAIL_FROM'),
    wiremockUrl: required('WIREMOCK_URL').replace(/\/+$/, ''),
    oraclePathPrefix: prefix === '' ? '' : `/${prefix.replace(/^\/+|\/+$/g, '')}`,
    oraclePollSeconds: positiveSeconds('ORACLE_POLL_SECONDS', 2),
    svixUrl: required('SVIX_URL').replace(/\/+$/, ''),
    svixApiKey: required('SVIX_API_KEY'),
    gotenbergUrl: required('GOTENBERG_URL').replace(/\/+$/, ''),
    deskTimeZone: timeZone('DESK_TIME_ZONE', 'America/St_Johns'),
    graceSeconds: positiveSeconds('GRACE_SECONDS', 300),
    stalenessSeconds: positiveSeconds('STALENESS_SECONDS', 3600),
    quoteTtlSeconds: positiveSeconds('QUOTE_TTL_SECONDS', 30),
    port: port('APP_PUBLIC_PORT', 4173),
  };
}

export function loadConfig(): Config {
  try {
    return readConfig();
  } catch (error) {
    if (error instanceof ConfigError) {
      process.stderr.write(`quillmoor: ${error.message}\n`);
      process.exit(1);
    }
    throw error;
  }
}

export const config: Config = loadConfig();
