/** Every service URL, credential, clock and timing setting, read from the environment at start. */

export interface Config {
  databaseUrl: string;
  s3: {
    endpoint: string;
    region: string;
    bucket: string;
    forcePathStyle: boolean;
    accessKeyId: string;
    secretAccessKey: string;
  };
  meilisearch: { url: string; apiKey: string; index: string };
  appClockStart: string | null;
  salesOfficeTz: string;
  holdSeconds: number;
  holdCooldownSeconds: number;
  holdAttemptWindowSeconds: number;
  sessionSeconds: number;
  mediaUrlSeconds: number;
  searchRateLimit: number;
  port: number;
  publicUrl: string;
}

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') throw new Error(`${name} must be set`);
  return value;
}

function optional(name: string, fallback: string): string {
  const value = process.env[name];
  return value === undefined || value === '' ? fallback : value;
}

function integer(name: string, fallback: number): number {
  const value = process.env[name];
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${name} must be a whole number`);
  return parsed;
}

export function loadConfig(): Config {
  return {
    databaseUrl: required('DATABASE_URL'),
    s3: {
      endpoint: required('S3_ENDPOINT'),
      region: optional('S3_REGION', 'us-east-1'),
      bucket: required('S3_BUCKET'),
      forcePathStyle: optional('S3_FORCE_PATH_STYLE', 'true') !== 'false',
      accessKeyId: required('S3_ACCESS_KEY_ID'),
      secretAccessKey: required('S3_SECRET_ACCESS_KEY'),
    },
    meilisearch: {
      url: required('MEILISEARCH_URL'),
      apiKey: optional('MEILISEARCH_API_KEY', ''),
      index: optional('MEILISEARCH_INDEX', 'units'),
    },
    appClockStart: process.env.APP_CLOCK_START ? process.env.APP_CLOCK_START : null,
    salesOfficeTz: optional('SALES_OFFICE_TZ', 'Australia/Sydney'),
    holdSeconds: integer('HOLD_SECONDS', 259200),
    holdCooldownSeconds: integer('HOLD_COOLDOWN_SECONDS', 86400),
    holdAttemptWindowSeconds: integer('HOLD_ATTEMPT_WINDOW_SECONDS', 600),
    sessionSeconds: integer('SESSION_SECONDS', 1209600),
    mediaUrlSeconds: integer('MEDIA_URL_SECONDS', 300),
    searchRateLimit: integer('SEARCH_RATE_LIMIT', 240),
    port: integer('APP_PUBLIC_PORT', 4173),
    publicUrl: optional('APP_PUBLIC_URL', ''),
  };
}

export const config: Config = loadConfig();

/** Hold attempts allowed inside one attempt window; the next one is refused. */
export const HOLD_ATTEMPT_LIMIT = 3;
