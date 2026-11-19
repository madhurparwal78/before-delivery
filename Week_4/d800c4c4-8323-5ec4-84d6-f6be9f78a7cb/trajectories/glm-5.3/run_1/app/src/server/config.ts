// Configuration: every service URL and credential is read from the environment at start.

export interface Config {
  port: number;
  publicUrl: string;
  databaseUrl: string;
  killbill: { url: string; username: string; password: string; apiKey: string; apiSecret: string };
  s3: { endpoint: string; region: string; bucket: string; forcePathStyle: boolean; accessKeyId: string; secretAccessKey: string };
  smtp: { host: string; port: number; from: string };
  reminderSweepSeconds: number;
  sessionIdleSeconds: number;
}

function wholeNumber(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  if (Number.isFinite(parsed) && parsed >= min && parsed <= max) return parsed;
  return fallback;
}

export function loadConfig(): Config {
  const env = process.env;
  const port = wholeNumber(env['APP_PUBLIC_PORT'], 4173, 1, 65535);
  return {
    port,
    publicUrl: env['APP_PUBLIC_URL'] ?? `http://127.0.0.1:${port}`,
    databaseUrl: required('DATABASE_URL'),
    killbill: {
      url: trimSlash(required('KILLBILL_URL')),
      username: required('KILLBILL_USERNAME'),
      password: required('KILLBILL_PASSWORD'),
      apiKey: required('KILLBILL_API_KEY'),
      apiSecret: required('KILLBILL_API_SECRET'),
    },
    s3: {
      endpoint: trimSlash(required('S3_ENDPOINT')),
      region: env['S3_REGION'] ?? 'us-east-1',
      bucket: required('S3_BUCKET'),
      forcePathStyle: (env['S3_FORCE_PATH_STYLE'] ?? 'true').toLowerCase() !== 'false',
      accessKeyId: required('S3_ACCESS_KEY_ID'),
      secretAccessKey: required('S3_SECRET_ACCESS_KEY'),
    },
    smtp: {
      host: required('SMTP_HOST'),
      port: wholeNumber(env['SMTP_PORT'], 1025, 1, 65535),
      from: env['MAIL_FROM'] ?? 'Pegworth Desk <desk@pegworth.example>',
    },
    reminderSweepSeconds: wholeNumber(env['REMINDER_SWEEP_SECONDS'], 60, 1, 60),
    sessionIdleSeconds: wholeNumber(env['SESSION_IDLE_SECONDS'], 1800, 10, 86400),
  };
}

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value;
}

function trimSlash(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value;
}
