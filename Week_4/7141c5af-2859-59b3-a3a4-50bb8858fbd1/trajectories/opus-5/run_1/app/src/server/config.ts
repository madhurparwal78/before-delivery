/**
 * Every credential and address is read from the environment here, once, at
 * start. Nothing in this module is ever sent to the browser.
 */

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

function optional(name: string): string | undefined {
  const value = process.env[name];
  return value && value.length > 0 ? value : undefined;
}

function seconds(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) throw new Error(`${name} is not a number of seconds`);
  return Math.floor(n);
}

export interface Config {
  readonly port: number;
  readonly publicUrl: string | undefined;
  readonly databaseUrl: string;
  readonly s3: {
    readonly endpoint: string;
    readonly region: string;
    readonly bucket: string;
    readonly forcePathStyle: boolean;
    readonly accessKeyId: string;
    readonly secretAccessKey: string;
  };
  readonly smtp: { readonly host: string; readonly port: number; readonly from: string };
  readonly wiremockUrl: string;
  readonly gotenbergUrl: string;
  readonly search: {
    readonly url: string;
    readonly apiKey: string | undefined;
    readonly indexPrefix: string;
  };
  readonly timers: {
    readonly enquiryRateWindowSeconds: number;
    readonly fileRateWindowSeconds: number;
    readonly stockCacheSeconds: number;
    readonly closureWaitSeconds: number;
    readonly holdDays: number;
    readonly clientPageSeconds: number;
    readonly reminderAfterSeconds: number;
    readonly sessionSeconds: number;
  };
}

export const MAIL_FROM_DEFAULT = 'Semenza Desk <desk@bottega-semenza.example>';
export const CONSERVATOR_ENQUIRY_ADDRESS = 'agnese@bottega-semenza.example';

export function loadConfig(): Config {
  return {
    port: Number(process.env.APP_PUBLIC_PORT ?? 4173),
    publicUrl: optional('APP_PUBLIC_URL'),
    databaseUrl: required('DATABASE_URL'),
    s3: {
      endpoint: required('S3_ENDPOINT'),
      region: process.env.S3_REGION ?? 'us-east-1',
      bucket: required('S3_BUCKET'),
      forcePathStyle: (process.env.S3_FORCE_PATH_STYLE ?? 'true') !== 'false',
      accessKeyId: required('S3_ACCESS_KEY_ID'),
      secretAccessKey: required('S3_SECRET_ACCESS_KEY'),
    },
    smtp: {
      host: required('SMTP_HOST'),
      port: Number(process.env.SMTP_PORT ?? 1025),
      from: process.env.MAIL_FROM ?? MAIL_FROM_DEFAULT,
    },
    wiremockUrl: required('WIREMOCK_URL').replace(/\/+$/, ''),
    gotenbergUrl: required('GOTENBERG_URL').replace(/\/+$/, ''),
    search: {
      url: required('MEILISEARCH_URL').replace(/\/+$/, ''),
      apiKey: optional('MEILISEARCH_API_KEY'),
      indexPrefix: process.env.SEARCH_INDEX_PREFIX ?? 'main',
    },
    timers: {
      enquiryRateWindowSeconds: seconds('ENQUIRY_RATE_WINDOW_SECONDS', 3600),
      fileRateWindowSeconds: seconds('FILE_RATE_WINDOW_SECONDS', 3600),
      stockCacheSeconds: seconds('STOCK_CACHE_SECONDS', 300),
      closureWaitSeconds: seconds('CLOSURE_WAIT_SECONDS', 2592000),
      holdDays: seconds('HOLD_DAYS', 7),
      clientPageSeconds: seconds('CLIENT_PAGE_SECONDS', 1209600),
      reminderAfterSeconds: seconds('REMINDER_AFTER_SECONDS', 604800),
      sessionSeconds: seconds('SESSION_SECONDS', 604800),
    },
  };
}

/** How many downloads of a dossier a desk gets in one file-rate window. */
export const DOSSIER_DOWNLOAD_LIMIT = 5;
/** How many valid enquiries one address gets in one enquiry window. */
export const ENQUIRY_LIMIT = 3;
/** The longest a provider may take before it counts as unavailable. */
export const PROVIDER_TIMEOUT_MS = 5000;
