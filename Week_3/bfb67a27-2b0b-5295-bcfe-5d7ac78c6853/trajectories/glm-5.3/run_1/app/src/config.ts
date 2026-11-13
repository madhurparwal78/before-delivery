// Environment-derived configuration; nothing is hard-coded (DP-42, DP-46).

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value;
}

function positiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive whole number of seconds`);
  }
  return parsed;
}

export const DATABASE_URL = required('DATABASE_URL');
export const KILLBILL_URL = required('KILLBILL_URL');
export const KILLBILL_USERNAME = required('KILLBILL_USERNAME');
export const KILLBILL_PASSWORD = required('KILLBILL_PASSWORD');
export const KILLBILL_API_KEY = required('KILLBILL_API_KEY');
export const KILLBILL_API_SECRET = required('KILLBILL_API_SECRET');
export const S3_ENDPOINT = required('S3_ENDPOINT');
export const S3_REGION = required('S3_REGION');
export const S3_BUCKET = required('S3_BUCKET');
export const S3_FORCE_PATH_STYLE = (process.env.S3_FORCE_PATH_STYLE ?? 'true') === 'true';
export const S3_ACCESS_KEY_ID = required('S3_ACCESS_KEY_ID');
export const S3_SECRET_ACCESS_KEY = required('S3_SECRET_ACCESS_KEY');
export const SMTP_HOST = required('SMTP_HOST');
export const SMTP_PORT = Number.parseInt(required('SMTP_PORT'), 10);
export const MAIL_FROM = required('MAIL_FROM');
export const HOLD_SECONDS = positiveInt('HOLD_SECONDS', 172800);
export const APP_PUBLIC_PORT = (() => {
  const raw = process.env.APP_PUBLIC_PORT;
  if (raw === undefined || raw === '') {
    return 4173;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) {
    throw new Error('APP_PUBLIC_PORT must be a valid port');
  }
  return parsed;
})();
