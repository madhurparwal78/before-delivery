function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`missing environment variable ${name}`);
  }
  return value;
}

export interface AppConfig {
  port: number;
  publicUrl: string;
  databaseUrl: string;
  smtpHost: string;
  smtpPort: number;
  mailpitUrl: string;
  killbill: {
    url: string;
    username: string;
    password: string;
    apiKey: string;
    apiSecret: string;
  };
  storage: {
    endpoint: string;
    region: string;
    bucket: string;
    forcePathStyle: boolean;
    accessKeyId: string;
    secretAccessKey: string;
  };
}

function trimTrailingSlash(url: string): string {
  return url.endsWith('/') ? url.slice(0, -1) : url;
}

export function loadConfig(): AppConfig {
  const port = Number(process.env.APP_PUBLIC_PORT ?? '4173');
  return {
    port,
    publicUrl: trimTrailingSlash(process.env.APP_PUBLIC_URL ?? `http://localhost:${port}`),
    databaseUrl: required('DATABASE_URL'),
    smtpHost: required('SMTP_HOST'),
    smtpPort: Number(required('SMTP_PORT')),
    mailpitUrl: trimTrailingSlash(required('MAILPIT_URL')),
    killbill: {
      url: trimTrailingSlash(required('KILLBILL_URL')),
      username: required('KILLBILL_USERNAME'),
      password: required('KILLBILL_PASSWORD'),
      apiKey: required('KILLBILL_API_KEY'),
      apiSecret: required('KILLBILL_API_SECRET'),
    },
    storage: {
      endpoint: required('S3_ENDPOINT'),
      region: required('S3_REGION'),
      bucket: required('S3_BUCKET'),
      forcePathStyle: required('S3_FORCE_PATH_STYLE') === 'true',
      accessKeyId: required('S3_ACCESS_KEY_ID'),
      secretAccessKey: required('S3_SECRET_ACCESS_KEY'),
    },
  };
}

export const config: AppConfig = loadConfig();
