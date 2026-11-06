/** The one place the process environment is read. Provider addresses and credentials have no default. */

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} must be set in the environment`);
  return value;
}

function positive(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

const withoutTrailingSlash = (url: string): string => url.replace(/\/+$/, '');

export const config = {
  port: positive('APP_PUBLIC_PORT', 4173),
  databaseUrl: required('DATABASE_URL'),
  killbill: {
    url: withoutTrailingSlash(required('KILLBILL_URL')),
    username: required('KILLBILL_USERNAME'),
    password: required('KILLBILL_PASSWORD'),
    apiKey: required('KILLBILL_API_KEY'),
    apiSecret: required('KILLBILL_API_SECRET'),
    callbackOrigin: withoutTrailingSlash(process.env['KILLBILL_CALLBACK_ORIGIN'] ?? ''),
  },
  smtp: {
    host: required('SMTP_HOST'),
    port: Number(required('SMTP_PORT')),
    from: required('MAIL_FROM'),
  },
  wiremockUrl: withoutTrailingSlash(required('WIREMOCK_URL')),
  holdSeconds: positive('HOLD_SECONDS', 600),
  sessionSeconds: positive('SESSION_SECONDS', 43200),
  shopClockStart: process.env['SHOP_CLOCK_START'] ?? '',
  shopClockRate: positive('SHOP_CLOCK_RATE', 1),
};

/** The origin Kill Bill posts to for this instance. */
export function callbackOrigin(): string {
  return config.killbill.callbackOrigin || `http://main:${config.port}`;
}

/** The administrative database URL and the database name, for creating a missing database. */
export function databaseParts(): { admin: string; name: string } {
  const url = new URL(config.databaseUrl);
  const name = decodeURIComponent(url.pathname.replace(/^\//, ''));
  url.pathname = '/postgres';
  return { admin: url.toString(), name };
}
