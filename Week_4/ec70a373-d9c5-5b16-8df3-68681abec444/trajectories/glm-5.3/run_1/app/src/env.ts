import fs from 'node:fs';
import path from 'node:path';

export interface Env {
  DATABASE_URL: string;
  KILLBILL_URL: string;
  KILLBILL_USERNAME: string;
  KILLBILL_PASSWORD: string;
  KILLBILL_API_KEY: string;
  KILLBILL_API_SECRET: string;
  S3_ENDPOINT: string;
  S3_REGION: string;
  S3_BUCKET: string;
  S3_FORCE_PATH_STYLE: boolean;
  S3_ACCESS_KEY_ID: string;
  S3_SECRET_ACCESS_KEY: string;
  SMTP_HOST: string;
  SMTP_PORT: number;
  MAIL_FROM: string;
  APP_PUBLIC_PORT: number;
  HOLD_TTL_SECONDS: number;
  INSPECTOR_LINK_TTL_SECONDS: number;
  SESSION_IDLE_SECONDS: number;
  SESSION_ABSOLUTE_SECONDS: number;
  SIGN_IN_THROTTLE_WINDOW_SECONDS: number;
  PILOTLIGHT_CLOCK_START: Date | null;
  PILOTLIGHT_SEED_SET: 'site-day' | 'pack-expiry' | null;
}

const CLOCK_DRIFT_GUARD = 50 * 365 * 24 * 3600 * 1000;

function intEnv(raw: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(raw ?? '', 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function loadEnv(): Env {
  const startRaw = process.env.PILOTLIGHT_CLOCK_START;
  let clockStart: Date | null = null;
  if (startRaw !== undefined && startRaw.trim() !== '') {
    const parsed = new Date(startRaw);
    if (Number.isNaN(parsed.getTime()) || Math.abs(parsed.getTime() - Date.now()) > CLOCK_DRIFT_GUARD) {
      throw new Error('PILOTLIGHT_CLOCK_START must hold an ISO-8601 UTC instant.');
    }
    clockStart = parsed;
  }
  const seedRaw = process.env.PILOTLIGHT_SEED_SET;
  if (seedRaw !== undefined && seedRaw !== '') {
    if (seedRaw !== 'site-day' && seedRaw !== 'pack-expiry') {
      throw new Error(`PILOTLIGHT_SEED_SET must be site-day or pack-expiry, got ${seedRaw}`);
    }
  }
  return {
    DATABASE_URL: process.env.DATABASE_URL ?? '',
    KILLBILL_URL: process.env.KILLBILL_URL ?? '',
    KILLBILL_USERNAME: process.env.KILLBILL_USERNAME ?? '',
    KILLBILL_PASSWORD: process.env.KILLBILL_PASSWORD ?? '',
    KILLBILL_API_KEY: process.env.KILLBILL_API_KEY ?? '',
    KILLBILL_API_SECRET: process.env.KILLBILL_API_SECRET ?? '',
    S3_ENDPOINT: process.env.S3_ENDPOINT ?? '',
    S3_REGION: process.env.S3_REGION ?? 'us-east-1',
    S3_BUCKET: process.env.S3_BUCKET ?? '',
    S3_FORCE_PATH_STYLE: (process.env.S3_FORCE_PATH_STYLE ?? '').toLowerCase() !== 'false',
    S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID ?? '',
    S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY ?? '',
    SMTP_HOST: process.env.SMTP_HOST ?? '',
    SMTP_PORT: intEnv(process.env.SMTP_PORT, 1025),
    MAIL_FROM: process.env.MAIL_FROM ?? 'Pilotlight <tickets@pilotlight.example>',
    APP_PUBLIC_PORT: intEnv(process.env.APP_PUBLIC_PORT, 4173),
    HOLD_TTL_SECONDS: intEnv(process.env.HOLD_TTL_SECONDS, 600),
    INSPECTOR_LINK_TTL_SECONDS: intEnv(process.env.INSPECTOR_LINK_TTL_SECONDS, 259200),
    SESSION_IDLE_SECONDS: intEnv(process.env.SESSION_IDLE_SECONDS, 1800),
    SESSION_ABSOLUTE_SECONDS: intEnv(process.env.SESSION_ABSOLUTE_SECONDS, 43200),
    SIGN_IN_THROTTLE_WINDOW_SECONDS: intEnv(process.env.SIGN_IN_THROTTLE_WINDOW_SECONDS, 900),
    PILOTLIGHT_CLOCK_START: clockStart,
    PILOTLIGHT_SEED_SET:
      seedRaw === 'site-day' || seedRaw === 'pack-expiry' ? seedRaw : null,
  };
}

export function writeEnvStub(): void {
  const env = loadEnv();
  fs.writeFileSync(path.join(process.cwd(), 'dist', 'env.json'), JSON.stringify(env));
}
