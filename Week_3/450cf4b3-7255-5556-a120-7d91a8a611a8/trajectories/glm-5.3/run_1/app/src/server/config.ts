export interface Config {
  databaseUrl: string;
  port: number;
  kitchenTimeZone: string;
  holdSeconds: number;
  expirySweepSeconds: number;
  signinWindowSeconds: number;
  reauthSeconds: number;
  killbill: { url: string; username: string; password: string; apiKey: string; apiSecret: string };
  s3: { endpoint: string; region: string; bucket: string; forcePathStyle: boolean; accessKeyId: string; secretAccessKey: string };
  smtp: { host: string; port: number; from: string };
}

function need(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined) throw new Error(`Missing environment variable ${name}`);
  return v;
}

function num(name: string, fallback: number): number {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}

export function readConfig(): Config {
  return {
    databaseUrl: need('DATABASE_URL'),
    port: num('APP_PUBLIC_PORT', 4173),
    kitchenTimeZone: need('KITCHEN_TIME_ZONE', 'America/Chicago'),
    holdSeconds: num('HOLD_SECONDS', 90),
    expirySweepSeconds: num('EXPIRY_SWEEP_SECONDS', 3600),
    signinWindowSeconds: num('SIGNIN_WINDOW_SECONDS', 900),
    reauthSeconds: num('REAUTH_SECONDS', 300),
    killbill: {
      url: need('KILLBILL_URL').replace(/\/+$/, ''),
      username: need('KILLBILL_USERNAME'),
      password: need('KILLBILL_PASSWORD'),
      apiKey: need('KILLBILL_API_KEY'),
      apiSecret: need('KILLBILL_API_SECRET'),
    },
    s3: {
      endpoint: need('S3_ENDPOINT').replace(/\/+$/, ''),
      region: need('S3_REGION', 'us-east-1'),
      bucket: need('S3_BUCKET'),
      forcePathStyle: need('S3_FORCE_PATH_STYLE', 'true') !== 'false',
      accessKeyId: need('S3_ACCESS_KEY_ID'),
      secretAccessKey: need('S3_SECRET_ACCESS_KEY'),
    },
    smtp: { host: need('SMTP_HOST'), port: num('SMTP_PORT', 1025), from: need('MAIL_FROM', 'Stationhouse <frontdesk@stationhouse.test>') },
  };
}
