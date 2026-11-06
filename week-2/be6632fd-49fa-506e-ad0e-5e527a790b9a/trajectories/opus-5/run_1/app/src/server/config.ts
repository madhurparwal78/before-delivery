function text(name: string, fallback: string): string {
  const value = process.env[name];
  return value === undefined || value === '' ? fallback : value;
}

function seconds(name: string, fallback: number): number {
  const value = process.env[name];
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`${name} is required`);
  }
  return value;
}

const port = seconds('APP_PUBLIC_PORT', 4173);

export const config = {
  port,
  publicUrl: text('APP_PUBLIC_URL', `http://127.0.0.1:${port}`).replace(/\/+$/, ''),
  databaseUrl: required('DATABASE_URL'),
  storage: {
    endpoint: text('S3_ENDPOINT', 'http://127.0.0.1:9000'),
    region: text('S3_REGION', 'us-east-1'),
    bucket: text('S3_BUCKET', 'hourline'),
    forcePathStyle: text('S3_FORCE_PATH_STYLE', 'true') === 'true',
    accessKeyId: text('S3_ACCESS_KEY_ID', ''),
    secretAccessKey: text('S3_SECRET_ACCESS_KEY', ''),
  },
  killbill: {
    url: text('KILLBILL_URL', 'http://127.0.0.1:8080').replace(/\/+$/, ''),
    username: text('KILLBILL_USERNAME', ''),
    password: text('KILLBILL_PASSWORD', ''),
    apiKey: text('KILLBILL_API_KEY', ''),
    apiSecret: text('KILLBILL_API_SECRET', ''),
  },
  mail: {
    host: text('SMTP_HOST', '127.0.0.1'),
    port: seconds('SMTP_PORT', 1025),
    from: text('MAIL_FROM', 'Hourline <launch@hourline.example>'),
  },
  ttl: {
    sessionSeconds: seconds('SESSION_TTL_SECONDS', 28_800),
    previewLinkSeconds: seconds('PREVIEW_LINK_TTL_SECONDS', 604_800),
    optInLinkSeconds: seconds('OPT_IN_LINK_TTL_SECONDS', 86_400),
    inviteLinkSeconds: seconds('INVITE_LINK_TTL_SECONDS', 604_800),
    resetLinkSeconds: seconds('RESET_LINK_TTL_SECONDS', 3_600),
  },
  rateLimit: {
    waitlistWindowSeconds: seconds('WAITLIST_RATE_WINDOW_SECONDS', 600),
    waitlistMax: 5,
  },
} as const;

export const LIMITS = {
  jsonBodyBytes: 256_000,
  lineSheetFileBytes: 1_000_000,
  lookFileBytes: 8_000_000,
  multipartEnvelopeBytes: 100_000,
  storyCharacters: 100_000,
  pageSize: 12,
  stockistPageMax: 50,
  stockistPageDefault: 25,
} as const;
