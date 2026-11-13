import fs from 'node:fs';
import path from 'node:path';

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
  wiremockUrl: string;
  offerWindowSeconds: number;
  leaverWindowSeconds: number;
  offerWarningSeconds: number;
  leaverWarningsSeconds: number[];
  port: number;
}

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number(raw.trim());
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

export function loadConfig(): Config {
  return {
    databaseUrl: process.env.DATABASE_URL ?? '',
    s3: {
      endpoint: process.env.S3_ENDPOINT ?? '',
      region: process.env.S3_REGION ?? '',
      bucket: process.env.S3_BUCKET ?? '',
      forcePathStyle: (process.env.S3_FORCE_PATH_STYLE ?? '').toLowerCase() === 'true',
      accessKeyId: process.env.S3_ACCESS_KEY_ID ?? '',
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? '',
    },
    wiremockUrl: process.env.WIREMOCK_URL ?? '',
    offerWindowSeconds: intEnv('OFFER_WINDOW_SECONDS', 2_592_000),
    leaverWindowSeconds: intEnv('LEAVER_WINDOW_SECONDS', 7_776_000),
    offerWarningSeconds: intEnv('OFFER_WARNING_SECONDS', 86_400),
    leaverWarningsSeconds: (process.env.LEAVER_WARNINGS_SECONDS ?? '2592000,604800,86400')
      .split(',')
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isInteger(n) && n > 0),
    port: intEnv('APP_PUBLIC_PORT', 4173),
  };
}

export function readAsset(rel: string): Buffer {
  return fs.readFileSync(path.join(process.cwd(), rel));
}
