function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`missing environment variable ${name}`);
  }
  return value;
}

function optional(name: string, fallback: string): string {
  const value = process.env[name];
  return value === undefined || value === '' ? fallback : value;
}

function seconds(name: string, fallback: number): number {
  const value = process.env[name];
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`environment variable ${name} must be a positive number of seconds`);
  }
  return Math.floor(parsed);
}

export const config = {
  databaseUrl: required('DATABASE_URL'),
  killbill: {
    url: required('KILLBILL_URL').replace(/\/+$/, ''),
    username: required('KILLBILL_USERNAME'),
    password: required('KILLBILL_PASSWORD'),
    apiKey: required('KILLBILL_API_KEY'),
    apiSecret: required('KILLBILL_API_SECRET'),
  },
  mail: {
    host: required('SMTP_HOST'),
    port: Number(optional('SMTP_PORT', '1025')),
    apiUrl: optional('MAILPIT_URL', '').replace(/\/+$/, ''),
    from: optional('MAIL_FROM', 'Kerf Frequencies <tickets@kerf.example>'),
  },
  storage: {
    endpoint: required('S3_ENDPOINT').replace(/\/+$/, ''),
    region: optional('S3_REGION', 'us-east-1'),
    bucket: required('S3_BUCKET'),
    forcePathStyle: optional('S3_FORCE_PATH_STYLE', 'true') === 'true',
    accessKeyId: required('S3_ACCESS_KEY_ID'),
    secretAccessKey: required('S3_SECRET_ACCESS_KEY'),
  },
  port: Number(optional('APP_PUBLIC_PORT', '4173')),
  appSecretFromEnv: process.env['APP_SECRET'] ?? null,
  times: {
    holdSeconds: seconds('HOLD_SECONDS', 600),
    waitlistClaimSeconds: seconds('WAITLIST_CLAIM_SECONDS', 7200),
    proofDecisionSeconds: seconds('PROOF_DECISION_SECONDS', 259200),
    billingDaySeconds: seconds('BILLING_DAY_SECONDS', 86400),
    signedReadSeconds: seconds('SIGNED_READ_SECONDS', 60),
  },
} as const;

export const limits = {
  jsonBytes: 100_000,
  proofBytes: 5_000_000,
  artworkBytes: 10_000_000,
} as const;
