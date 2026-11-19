// Configuration read from the environment at start (DP-55). Nothing here is ever
// sent to the browser.
export interface Config {
  port: number;
  publicUrl: string;
  databaseUrl: string;
  s3: {
    endpoint: string;
    region: string;
    bucket: string;
    forcePathStyle: boolean;
    accessKeyId: string;
    secretAccessKey: string;
  };
  meilisearch: {
    url: string;
    apiKey: string;
    index: string;
  };
  clockStart: number | null; // epoch ms, or null to use the system clock
  salesOfficeTz: string;
  holdSeconds: number;
  holdCooldownSeconds: number;
  holdAttemptWindowSeconds: number;
  sessionSeconds: number;
  mediaUrlSeconds: number;
  searchRateLimit: number;
}

const int = (name: string, fallback: number): number => {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) return fallback;
  return value;
};

const str = (name: string, fallback: string): string => {
  const raw = process.env[name];
  return raw === undefined || raw === '' ? fallback : raw;
};

export function loadConfig(): Config {
  const clockRaw = process.env.APP_CLOCK_START;
  const clockStart = clockRaw ? Date.parse(clockRaw) : null;
  return {
    port: int('APP_PUBLIC_PORT', 4173),
    publicUrl: str('APP_PUBLIC_URL', `http://127.0.0.1:${int('APP_PUBLIC_PORT', 4173)}`),
    databaseUrl: str('DATABASE_URL', ''),
    s3: {
      endpoint: str('S3_ENDPOINT', ''),
      region: str('S3_REGION', 'us-east-1'),
      bucket: str('S3_BUCKET', ''),
      forcePathStyle: str('S3_FORCE_PATH_STYLE', 'true') !== 'false',
      accessKeyId: str('S3_ACCESS_KEY_ID', ''),
      secretAccessKey: str('S3_SECRET_ACCESS_KEY', ''),
    },
    meilisearch: {
      url: str('MEILISEARCH_URL', ''),
      apiKey: str('MEILISEARCH_API_KEY', ''),
      index: str('MEILISEARCH_INDEX', 'units'),
    },
    clockStart: clockStart !== null && Number.isFinite(clockStart) ? clockStart : null,
    salesOfficeTz: str('SALES_OFFICE_TZ', 'Australia/Sydney'),
    holdSeconds: int('HOLD_SECONDS', 259200),
    holdCooldownSeconds: int('HOLD_COOLDOWN_SECONDS', 86400),
    holdAttemptWindowSeconds: int('HOLD_ATTEMPT_WINDOW_SECONDS', 600),
    sessionSeconds: int('SESSION_SECONDS', 1209600),
    mediaUrlSeconds: int('MEDIA_URL_SECONDS', 300),
    searchRateLimit: int('SEARCH_RATE_LIMIT', 240),
  };
}
