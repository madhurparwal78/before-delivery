export interface AppConfig {
  port: number;
  publicUrl: string;
  databaseUrl: string;
  keycloak: {
    url: string;
    realm: string;
    issuerUrl: string;
    clientId: string;
    clientSecret: string;
  };
  killbill: {
    url: string;
    username: string;
    password: string;
    apiKey: string;
    apiSecret: string;
  };
  valkeyUrl: string;
  svix: { url: string; apiKey: string };
  s3: {
    endpoint: string;
    region: string;
    bucket: string;
    forcePathStyle: boolean;
    accessKeyId: string;
    secretAccessKey: string;
  };
  smtp: { host: string; port: number; from: string };
  overduePollSeconds: number;
  dunningFinalNoticeSeconds: number;
  inviteTtlSeconds: number;
}

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value;
}

function optionalInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function loadConfig(): AppConfig {
  return {
    port: optionalInt('APP_PUBLIC_PORT', 4173),
    publicUrl: process.env.APP_PUBLIC_URL ?? '',
    databaseUrl: required('DATABASE_URL'),
    keycloak: {
      url: required('KEYCLOAK_URL'),
      realm: required('KEYCLOAK_REALM'),
      issuerUrl: required('AUTH_ISSUER_URL'),
      clientId: required('AUTH_CLIENT_ID'),
      clientSecret: required('AUTH_CLIENT_SECRET'),
    },
    killbill: {
      url: required('KILLBILL_URL'),
      username: required('KILLBILL_USERNAME'),
      password: required('KILLBILL_PASSWORD'),
      apiKey: required('KILLBILL_API_KEY'),
      apiSecret: required('KILLBILL_API_SECRET'),
    },
    valkeyUrl: required('VALKEY_URL'),
    svix: { url: required('SVIX_URL'), apiKey: required('SVIX_API_KEY') },
    s3: {
      endpoint: required('S3_ENDPOINT'),
      region: process.env.S3_REGION ?? 'us-east-1',
      bucket: required('S3_BUCKET'),
      forcePathStyle: (process.env.S3_FORCE_PATH_STYLE ?? 'false') === 'true',
      accessKeyId: required('S3_ACCESS_KEY_ID'),
      secretAccessKey: required('S3_SECRET_ACCESS_KEY'),
    },
    smtp: {
      host: required('SMTP_HOST'),
      port: optionalInt('SMTP_PORT', 1025),
      from: process.env.MAIL_FROM ?? 'Plumtide Venue <venue@plumtide.example>',
    },
    overduePollSeconds: optionalInt('OVERDUE_POLL_SECONDS', 15),
    dunningFinalNoticeSeconds: optionalInt('DUNNING_FINAL_NOTICE_SECONDS', 259200),
    inviteTtlSeconds: optionalInt('INVITE_TTL_SECONDS', 604800),
  };
}
