// Every credential, URL and timer comes from the environment, read once at start.
function envInt(name: string, def: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return def;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : def;
}

const publicPort = envInt('APP_PUBLIC_PORT', 4173);

export const config = {
  port: publicPort,
  publicUrl: process.env.APP_PUBLIC_URL && process.env.APP_PUBLIC_URL.length > 0 ? process.env.APP_PUBLIC_URL.replace(/\/$/, '') : `http://localhost:${publicPort}`,
  databaseUrl: process.env.DATABASE_URL ?? '',
  s3: {
    endpoint: process.env.S3_ENDPOINT ?? '',
    region: process.env.S3_REGION ?? 'us-east-1',
    bucket: process.env.S3_BUCKET ?? '',
    forcePathStyle: (process.env.S3_FORCE_PATH_STYLE ?? 'true') !== 'false',
    accessKeyId: process.env.S3_ACCESS_KEY_ID ?? '',
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? '',
  },
  killbill: {
    url: (process.env.KILLBILL_URL ?? '').replace(/\/$/, ''),
    username: process.env.KILLBILL_USERNAME ?? '',
    password: process.env.KILLBILL_PASSWORD ?? '',
    apiKey: process.env.KILLBILL_API_KEY ?? '',
    apiSecret: process.env.KILLBILL_API_SECRET ?? '',
  },
  smtp: {
    host: process.env.SMTP_HOST ?? '',
    port: envInt('SMTP_PORT', 1025),
    from: process.env.MAIL_FROM ?? 'Lanternline Desk <desk@lanternline.example>',
  },
  answerWindowSeconds: envInt('ANSWER_WINDOW_SECONDS', 3600),
  reviewClaimSeconds: envInt('REVIEW_CLAIM_SECONDS', 900),
  dataRequestPageSeconds: envInt('DATA_REQUEST_PAGE_SECONDS', 86400),
  retentionSeconds: envInt('RETENTION_SECONDS', 157680000),
  partnerRateWindowSeconds: envInt('PARTNER_RATE_WINDOW_SECONDS', 60),
  regulatorFileRateWindowSeconds: envInt('REGULATOR_FILE_RATE_WINDOW_SECONDS', 600),
  sessionSeconds: envInt('SESSION_SECONDS', 28800),
} as const;
