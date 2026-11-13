// Read at start from the environment. No credential is hard-coded, logged or sent to the browser. DP-39, DP-45.

export interface ServerConfig {
  databaseUrl: string;
  s3: {
    endpoint: string;
    region: string;
    bucket: string;
    forcePathStyle: boolean;
    accessKeyId: string;
    secretAccessKey: string;
  };
  port: number;
  grading: boolean;
  attachmentMaxBytes: number;
  timers: {
    undo_ms: number;
    connecting_delay_ms: number;
    availability_debounce_ms: number;
    retry_base_ms: number;
    retry_cap_ms: number;
    toast_ms: number;
  };
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export function loadConfig(): ServerConfig {
  return {
    databaseUrl: required('DATABASE_URL'),
    s3: {
      endpoint: required('S3_ENDPOINT'),
      region: process.env.S3_REGION ?? 'us-east-1',
      bucket: required('S3_BUCKET'),
      forcePathStyle: (process.env.S3_FORCE_PATH_STYLE ?? 'false') === 'true',
      accessKeyId: required('S3_ACCESS_KEY_ID'),
      secretAccessKey: required('S3_SECRET_ACCESS_KEY'),
    },
    port: intEnv('APP_PUBLIC_PORT', 4173),
    grading: process.env.GRADING === '1',
    attachmentMaxBytes: intEnv('ATTACHMENT_MAX_BYTES', 26_214_400),
    timers: {
      undo_ms: intEnv('UNDO_MS', 5000),
      connecting_delay_ms: intEnv('CONNECTING_DELAY_MS', 2000),
      availability_debounce_ms: intEnv('AVAILABILITY_DEBOUNCE_MS', 300),
      retry_base_ms: intEnv('RETRY_BASE_MS', 1000),
      retry_cap_ms: intEnv('RETRY_CAP_MS', 60_000),
      toast_ms: intEnv('TOAST_MS', 4000),
    },
  };
}

export const config = loadConfig();
