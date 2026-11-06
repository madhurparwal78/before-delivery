function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`missing environment variable ${name}`);
  return value;
}

function seconds(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`invalid ${name}`);
  return Math.floor(value);
}

export type Config = {
  port: number;
  baseUrl: string | null;
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
  mail: { host: string; port: number; from: string };
  optionChallengeSeconds: number;
  packageLinkTtlSeconds: number;
  consentLinkTtlSeconds: number;
  sessionTtlSeconds: number;
};

export const config: Config = {
  port: Number(process.env.APP_PUBLIC_PORT ?? '4173'),
  baseUrl: process.env.APP_BASE_URL ?? null,
  databaseUrl: required('DATABASE_URL'),
  s3: {
    endpoint: required('S3_ENDPOINT'),
    region: process.env.S3_REGION ?? 'us-east-1',
    bucket: required('S3_BUCKET'),
    forcePathStyle: (process.env.S3_FORCE_PATH_STYLE ?? 'true') === 'true',
    accessKeyId: required('S3_ACCESS_KEY_ID'),
    secretAccessKey: required('S3_SECRET_ACCESS_KEY'),
  },
  killbill: {
    url: required('KILLBILL_URL'),
    username: required('KILLBILL_USERNAME'),
    password: required('KILLBILL_PASSWORD'),
    apiKey: required('KILLBILL_API_KEY'),
    apiSecret: required('KILLBILL_API_SECRET'),
  },
  mail: {
    host: required('SMTP_HOST'),
    port: Number(process.env.SMTP_PORT ?? '1025'),
    from: required('MAIL_FROM'),
  },
  optionChallengeSeconds: seconds('OPTION_CHALLENGE_SECONDS', 14_400),
  packageLinkTtlSeconds: seconds('PACKAGE_LINK_TTL_SECONDS', 1_209_600),
  consentLinkTtlSeconds: seconds('CONSENT_LINK_TTL_SECONDS', 604_800),
  sessionTtlSeconds: seconds('SESSION_TTL_SECONDS', 28_800),
};

export function appBaseUrl(): string {
  return config.baseUrl ?? `http://127.0.0.1:${config.port}`;
}
