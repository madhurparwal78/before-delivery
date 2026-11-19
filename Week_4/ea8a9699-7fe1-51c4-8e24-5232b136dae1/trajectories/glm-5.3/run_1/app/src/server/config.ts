export interface Config {
  port: number;
  publicBaseUrl: string;
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
  smtp: {
    host: string;
    port: number;
    from: string;
  };
}

export function loadConfig(): Config {
  const port = Number(process.env.APP_PUBLIC_PORT ?? 4173);
  const databaseUrl = requireEnv('DATABASE_URL');
  return {
    port,
    publicBaseUrl: (process.env.APP_PUBLIC_URL ?? `http://localhost:${port}`).replace(/\/$/, ''),
    databaseUrl,
    s3: {
      endpoint: requireEnv('S3_ENDPOINT'),
      region: requireEnv('S3_REGION'),
      bucket: requireEnv('S3_BUCKET'),
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
      accessKeyId: requireEnv('S3_ACCESS_KEY_ID'),
      secretAccessKey: requireEnv('S3_SECRET_ACCESS_KEY'),
    },
    killbill: {
      url: requireEnv('KILLBILL_URL'),
      username: requireEnv('KILLBILL_USERNAME'),
      password: requireEnv('KILLBILL_PASSWORD'),
      apiKey: requireEnv('KILLBILL_API_KEY'),
      apiSecret: requireEnv('KILLBILL_API_SECRET'),
    },
    smtp: {
      host: requireEnv('SMTP_HOST'),
      port: Number(requireEnv('SMTP_PORT')),
      from: requireEnv('MAIL_FROM'),
    },
  };
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return v;
}
