function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') throw new Error(`Missing configuration: ${name}`);
  return value;
}

function optional(name: string): string | null {
  const value = process.env[name];
  return value === undefined || value === '' ? null : value;
}

function wholeNumber(name: string, fallback: number): number {
  const raw = optional(name);
  if (raw === null) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`Bad configuration: ${name}`);
  return value;
}

function officeKey(): string {
  const raw = optional('OFFICE_KEY') ?? 'bl';
  if (!/^[a-z]{2,8}$/.test(raw)) throw new Error('Bad configuration: OFFICE_KEY');
  return raw;
}

export const config = {
  port: wholeNumber('APP_PUBLIC_PORT', 4173),
  databaseUrl: required('DATABASE_URL'),
  keycloak: {
    url: required('KEYCLOAK_URL').replace(/\/+$/, ''),
    realm: required('KEYCLOAK_REALM'),
    issuerUrl: required('AUTH_ISSUER_URL').replace(/\/+$/, ''),
    clientId: required('AUTH_CLIENT_ID'),
    clientSecret: required('AUTH_CLIENT_SECRET'),
  },
  killbill: {
    url: required('KILLBILL_URL').replace(/\/+$/, ''),
    username: required('KILLBILL_USERNAME'),
    password: required('KILLBILL_PASSWORD'),
    apiKey: required('KILLBILL_API_KEY'),
    apiSecret: required('KILLBILL_API_SECRET'),
  },
  breachFeedUrl: required('WIREMOCK_URL').replace(/\/+$/, ''),
  officeKey: officeKey(),
  secretKeyHex: optional('LOCKSET_SECRET_KEY'),
  clockStart: optional('LOCKSET_CLOCK_START'),
  revealSessionSeconds: wholeNumber('REVEAL_SESSION_SECONDS', 28_800),
  breachCheckSeconds: wholeNumber('BREACH_CHECK_SECONDS', 60),
  signInLockSeconds: wholeNumber('SIGN_IN_LOCK_SECONDS', 900),
} as const;

export const OFFICE_NAME = 'Brannock & Lyle';
export const SEAT_PLAN = 'lockset-seat-annual';
export const SEAT_PRICE = '48.00';
export const SEAT_CURRENCY = 'USD';
