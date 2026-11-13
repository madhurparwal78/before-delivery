export interface AppConfig {
  port: number;
  databaseUrl: string;
  valkeyUrl: string;
  s3: {
    endpoint: string;
    region: string;
    bucket: string;
    forcePathStyle: boolean;
    accessKeyId: string;
    secretAccessKey: string;
  };
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value;
}

export function readConfig(): AppConfig {
  const portRaw = process.env.APP_PUBLIC_PORT;
  const port = portRaw ? Number.parseInt(portRaw, 10) : 4173;
  return {
    port: Number.isFinite(port) && port > 0 ? port : 4173,
    databaseUrl: requireEnv('DATABASE_URL'),
    valkeyUrl: requireEnv('VALKEY_URL'),
    s3: {
      endpoint: requireEnv('S3_ENDPOINT'),
      region: process.env.S3_REGION ?? 'us-east-1',
      bucket: requireEnv('S3_BUCKET'),
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
      accessKeyId: requireEnv('S3_ACCESS_KEY_ID'),
      secretAccessKey: requireEnv('S3_SECRET_ACCESS_KEY'),
    },
  };
}
