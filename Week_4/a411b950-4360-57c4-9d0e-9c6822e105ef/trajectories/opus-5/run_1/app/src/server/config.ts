function text(name: string, fallback?: string): string {
  const value = process.env[name];
  if (value !== undefined && value !== '') return value;
  if (fallback !== undefined) return fallback;
  throw new Error(`Missing environment variable ${name}`);
}

function integer(name: string, fallback: number): number {
  const value = process.env[name];
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) throw new Error(`Environment variable ${name} must be an integer`);
  return parsed;
}

const port = integer('APP_PUBLIC_PORT', 4173);

export type PacingPolicy = {
  perSender: number;
  perIp: number;
  windowSeconds: number;
};

export const config = {
  port,
  publicUrl: text('APP_PUBLIC_URL', `http://localhost:${port}`).replace(/\/+$/, ''),
  databaseUrl: text('DATABASE_URL'),
  storage: {
    endpoint: text('S3_ENDPOINT'),
    region: text('S3_REGION', 'us-east-1'),
    bucket: text('S3_BUCKET'),
    forcePathStyle: text('S3_FORCE_PATH_STYLE', 'true') === 'true',
    accessKeyId: text('S3_ACCESS_KEY_ID'),
    secretAccessKey: text('S3_SECRET_ACCESS_KEY'),
  },
  mail: {
    host: text('SMTP_HOST'),
    port: integer('SMTP_PORT', 1025),
    from: text('MAIL_FROM'),
    retrySeconds: integer('MAIL_RETRY_SECONDS', 10),
  },
  killbill: {
    url: text('KILLBILL_URL').replace(/\/+$/, ''),
    username: text('KILLBILL_USERNAME'),
    password: text('KILLBILL_PASSWORD'),
    apiKey: text('KILLBILL_API_KEY'),
    apiSecret: text('KILLBILL_API_SECRET'),
  },
  proposalLinkTtlSeconds: integer('PROPOSAL_LINK_TTL_SECONDS', 1_209_600),
  pacing: {
    perSender: integer('ENQUIRY_LIMIT_PER_SENDER', 3),
    perIp: integer('ENQUIRY_LIMIT_PER_IP', 200),
    windowSeconds: integer('ENQUIRY_RATE_WINDOW_SECONDS', 600),
  } satisfies PacingPolicy,
} as const;

export const pacingPolicyKey = `${config.pacing.perSender}:${config.pacing.perIp}:${config.pacing.windowSeconds}`;

export const ownOrigin = (() => {
  const url = new URL(config.publicUrl);
  return `${url.protocol}//${url.host}`;
})();
