export type Env = Record<string, string | undefined>;

export interface Config {
  port: number;
  publicUrl: string;
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
  smtp: { host: string; port: number; from: string };
  timers: {
    holdSeconds: number;
    brokerPageSeconds: number;
    manifestPageSeconds: number;
    manifestRetentionSeconds: number;
    sessionSeconds: number;
    brokerRateWindowSeconds: number;
  };
}

function int(value: string | undefined, fallback: number): number {
  const n = Number.parseInt(value ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function loadConfig(env: Env = process.env): Config {
  return {
    port: int(env.APP_PUBLIC_PORT, 4173),
    publicUrl: (env.APP_PUBLIC_URL ?? 'http://127.0.0.1:4173').replace(/\/+$/, ''),
    databaseUrl: env.DATABASE_URL ?? '',
    s3: {
      endpoint: env.S3_ENDPOINT ?? '',
      region: env.S3_REGION ?? 'us-east-1',
      bucket: env.S3_BUCKET ?? '',
      forcePathStyle: env.S3_FORCE_PATH_STYLE !== 'false',
      accessKeyId: env.S3_ACCESS_KEY_ID ?? '',
      secretAccessKey: env.S3_SECRET_ACCESS_KEY ?? '',
    },
    killbill: {
      url: (env.KILLBILL_URL ?? '').replace(/\/+$/, ''),
      username: env.KILLBILL_USERNAME ?? '',
      password: env.KILLBILL_PASSWORD ?? '',
      apiKey: env.KILLBILL_API_KEY ?? '',
      apiSecret: env.KILLBILL_API_SECRET ?? '',
    },
    smtp: {
      host: env.SMTP_HOST ?? '',
      port: int(env.SMTP_PORT, 1025),
      from: env.MAIL_FROM ?? 'Tidewright <bookings@tidewright.example>',
    },
    timers: {
      holdSeconds: int(env.HOLD_SECONDS, 172800),
      brokerPageSeconds: int(env.BROKER_PAGE_SECONDS, 1209600),
      manifestPageSeconds: int(env.MANIFEST_PAGE_SECONDS, 604800),
      manifestRetentionSeconds: int(env.MANIFEST_RETENTION_SECONDS, 2592000),
      sessionSeconds: int(env.SESSION_SECONDS, 28800),
      brokerRateWindowSeconds: int(env.BROKER_RATE_WINDOW_SECONDS, 600),
    },
  };
}
