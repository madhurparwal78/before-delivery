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
  smtp: {
    host: string;
    port: number;
    from: string;
  };
  editWindowSeconds: number;
  mentionUnansweredSeconds: number;
  digestIntervalSeconds: number | null;
  eventRetentionSeconds: number;
  appClockOffsetSeconds: number;
}

function wholeNumberEnv(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number(raw.trim());
  if (!Number.isFinite(n) || !Number.isInteger(n)) return fallback;
  return n;
}

export function loadConfig(): Config {
  const port = wholeNumberEnv(process.env.APP_PUBLIC_PORT, 4173);
  const digestInterval = wholeNumberEnv(process.env.DIGEST_INTERVAL_SECONDS, 0);
  return {
    port,
    publicUrl: process.env.APP_PUBLIC_URL && process.env.APP_PUBLIC_URL.trim() !== ''
      ? process.env.APP_PUBLIC_URL.trim().replace(/\/+$/, '')
      : `http://localhost:${port}`,
    databaseUrl: process.env.DATABASE_URL ?? '',
    s3: {
      endpoint: process.env.S3_ENDPOINT ?? '',
      region: process.env.S3_REGION ?? 'us-east-1',
      bucket: process.env.S3_BUCKET ?? '',
      forcePathStyle: (process.env.S3_FORCE_PATH_STYLE ?? 'true').toLowerCase() !== 'false',
      accessKeyId: process.env.S3_ACCESS_KEY_ID ?? '',
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? '',
    },
    smtp: {
      host: process.env.SMTP_HOST ?? '',
      port: wholeNumberEnv(process.env.SMTP_PORT, 1025),
      from: process.env.MAIL_FROM ?? 'Rimewire by Northcoil Works <no-reply@rimewire.example>',
    },
    editWindowSeconds: wholeNumberEnv(process.env.EDIT_WINDOW_SECONDS, 86400),
    mentionUnansweredSeconds: wholeNumberEnv(process.env.MENTION_UNANSWERED_SECONDS, 1800),
    digestIntervalSeconds: digestInterval > 0 ? digestInterval : null,
    eventRetentionSeconds: wholeNumberEnv(process.env.EVENT_RETENTION_SECONDS, 600),
    appClockOffsetSeconds: wholeNumberEnv(process.env.APP_CLOCK_OFFSET_SECONDS, 0),
  };
}
