// Reads every configuration value from the environment at start. Nothing is hard-coded or logged.

export type Config = {
  port: number;
  databaseUrl: string;
  s3: {
    endpoint: string;
    region: string;
    bucket: string;
    forcePathStyle: boolean;
    accessKeyId: string;
    secretAccessKey: string;
  };
  killbill: {
    url: string;
    username: string;
    password: string;
    apiKey: string;
    apiSecret: string;
  };
  idleSeconds: number;
  sessionCapSeconds: number;
  billingPrefix: string;
};

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === '') {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return v;
}

export function loadConfig(): Config {
  return {
    port: Number(process.env.APP_PUBLIC_PORT ?? '4173'),
    databaseUrl: requireEnv('DATABASE_URL'),
    s3: {
      endpoint: requireEnv('S3_ENDPOINT'),
      region: process.env.S3_REGION ?? 'us-east-1',
      bucket: requireEnv('S3_BUCKET'),
      forcePathStyle: /^(true|1)$/i.test(process.env.S3_FORCE_PATH_STYLE ?? 'true'),
      accessKeyId: requireEnv('S3_ACCESS_KEY_ID'),
      secretAccessKey: requireEnv('S3_SECRET_ACCESS_KEY'),
    },
    killbill: {
      url: requireEnv('KILLBILL_URL').replace(/\/+$/, ''),
      username: requireEnv('KILLBILL_USERNAME'),
      password: requireEnv('KILLBILL_PASSWORD'),
      apiKey: requireEnv('KILLBILL_API_KEY'),
      apiSecret: requireEnv('KILLBILL_API_SECRET'),
    },
    idleSeconds: Number(process.env.LOWFIELD_IDLE_SECONDS ?? '30'),
    sessionCapSeconds: Number(process.env.LOWFIELD_SESSION_CAP_SECONDS ?? '3600'),
    billingPrefix: process.env.LOWFIELD_BILLING_PREFIX ?? 'lowfield',
  };
}
