/** Every credential and URL is read from the environment at start. */
function requireEnv(name: string): string {
  const value = process.env[name];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`missing required configuration`);
  }
  return value;
}

function wholeSeconds(name: string, fallback: number): number {
  const raw = process.env[name];
  if (typeof raw !== 'string' || raw.trim().length === 0) return fallback;
  const parsed = Number(raw.trim());
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback;
  return parsed;
}

export interface VaultConfig {
  endpoint: string;
  region: string;
  bucket: string;
  forcePathStyle: boolean;
  accessKeyId: string;
  secretAccessKey: string;
}

export interface Config {
  databaseUrl: string;
  vault: VaultConfig;
  port: number;
  ethStaleSeconds: number;
  staffSessionIdleSeconds: number;
}

export function loadConfig(): Config {
  const portRaw = process.env.APP_PUBLIC_PORT;
  const port = typeof portRaw === 'string' && portRaw.trim() !== '' ? Number(portRaw.trim()) : 4173;
  return {
    databaseUrl: requireEnv('DATABASE_URL'),
    vault: {
      endpoint: requireEnv('S3_ENDPOINT'),
      region: process.env.S3_REGION ?? 'us-east-1',
      bucket: requireEnv('S3_BUCKET'),
      forcePathStyle: (process.env.S3_FORCE_PATH_STYLE ?? 'true').toLowerCase() !== 'false',
      accessKeyId: requireEnv('S3_ACCESS_KEY_ID'),
      secretAccessKey: requireEnv('S3_SECRET_ACCESS_KEY'),
    },
    port: Number.isInteger(port) && port > 0 ? port : 4173,
    ethStaleSeconds: wholeSeconds('ETH_STALE_SECONDS', 120),
    staffSessionIdleSeconds: wholeSeconds('STAFF_SESSION_IDLE_SECONDS', 1800),
  };
}
