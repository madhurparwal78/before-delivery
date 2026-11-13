import * as fs from 'node:fs';

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
  pocketbase: {
    url: string;
    adminEmail: string;
    adminPassword: string;
  };
  publicPort: number;
  publicUrl: string;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === '') {
    console.error(`Missing required environment variable ${name}`);
    process.exit(1);
  }
  return value.trim();
}

function optionalEnv(name: string, fallback: string): string {
  const value = process.env[name];
  return value === undefined || value.trim() === '' ? fallback : value.trim();
}

export function loadConfig(): Config {
  if (process.env.ELEVENS_LOCAL_FONT_OVERRIDES === undefined && fs.existsSync('/app/public/fonts')) {
    process.env.ELEVENS_LOCAL_FONT_OVERRIDES = '1';
  }
  const portText = optionalEnv('APP_PUBLIC_PORT', '4173');
  const publicPort = Number.parseInt(portText, 10);
  if (!Number.isInteger(publicPort) || publicPort <= 0) {
    console.error(`APP_PUBLIC_PORT must be a positive integer, got ${portText}`);
    process.exit(1);
  }
  return {
    databaseUrl: requireEnv('DATABASE_URL'),
    s3: {
      endpoint: requireEnv('S3_ENDPOINT'),
      region: requireEnv('S3_REGION'),
      bucket: requireEnv('S3_BUCKET'),
      forcePathStyle: optionalEnv('S3_FORCE_PATH_STYLE', 'true') !== 'false',
      accessKeyId: requireEnv('S3_ACCESS_KEY_ID'),
      secretAccessKey: requireEnv('S3_SECRET_ACCESS_KEY'),
    },
    pocketbase: {
      url: requireEnv('POCKETBASE_URL'),
      adminEmail: requireEnv('POCKETBASE_ADMIN_EMAIL'),
      adminPassword: requireEnv('POCKETBASE_ADMIN_PASSWORD'),
    },
    publicPort,
    publicUrl: optionalEnv('APP_PUBLIC_URL', `http://127.0.0.1:${publicPort}`),
  };
}
