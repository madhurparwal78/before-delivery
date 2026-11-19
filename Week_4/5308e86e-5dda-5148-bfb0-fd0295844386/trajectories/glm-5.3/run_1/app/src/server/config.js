import { readFileSync } from 'node:fs';

const env = process.env;

export const DATABASE_URL = env.DATABASE_URL || '';
export const APP_PUBLIC_PORT = Number(env.APP_PUBLIC_PORT || 4173);
export const APP_PUBLIC_URL = env.APP_PUBLIC_URL || `http://localhost:${APP_PUBLIC_PORT}`;
export const APP_NOW = env.APP_NOW || '';
export const LOGIN_LOCKOUT_WINDOW_SECONDS = Number(env.LOGIN_LOCKOUT_WINDOW_SECONDS || 900);
export const INQUIRY_RATE_WINDOW_SECONDS = Number(env.INQUIRY_RATE_WINDOW_SECONDS || 600);
export const FX_QUOTE_TTL_SECONDS = Number(env.FX_QUOTE_TTL_SECONDS || 600);
export const MAX_BODY_BYTES = 32768;
export const APPROVAL_THRESHOLD_CENTS = 500000;
export const DUAL_APPROVAL_THRESHOLD_CENTS = 5000000;
export const LOCKOUT_MAX_FAILURES = 5;
export const INQUIRY_MAX_IN_WINDOW = 5;
export const MAX_DB_CONNECTIONS = 10;
export const SRC_DIR = new URL('.', import.meta.url).pathname;
export const PUBLIC_DIR = new URL('../public/', import.meta.url).pathname;
export const VERSION = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version;
export const startedAt = Date.now();
