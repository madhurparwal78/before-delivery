function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') throw new Error(`missing environment variable ${name}`);
  return value;
}

function integer(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed)) throw new Error(`environment variable ${name} is not an integer`);
  return parsed;
}

export interface Config {
  readonly databaseUrl: string;
  readonly keycloak: {
    readonly url: string;
    readonly realm: string;
    readonly issuerUrl: string;
    readonly clientId: string;
    readonly clientSecret: string;
  };
  readonly killbill: {
    readonly url: string;
    readonly username: string;
    readonly password: string;
    readonly apiKey: string;
    readonly apiSecret: string;
  };
  readonly valkeyUrl: string;
  readonly svix: { readonly url: string; readonly apiKey: string };
  readonly s3: {
    readonly endpoint: string;
    readonly region: string;
    readonly bucket: string;
    readonly forcePathStyle: boolean;
    readonly accessKeyId: string;
    readonly secretAccessKey: string;
  };
  readonly mail: { readonly host: string; readonly port: number; readonly from: string };
  readonly app: {
    readonly publicUrl: string;
    readonly port: number;
    readonly overduePollSeconds: number;
    readonly dunningFinalNoticeSeconds: number;
    readonly inviteTtlSeconds: number;
  };
}

export const config: Config = {
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
    region: required('S3_REGION'),
    bucket: required('S3_BUCKET'),
    forcePathStyle: required('S3_FORCE_PATH_STYLE') === 'true',
    accessKeyId: required('S3_ACCESS_KEY_ID'),
    secretAccessKey: required('S3_SECRET_ACCESS_KEY'),
  },
  mail: { host: required('SMTP_HOST'), port: integer('SMTP_PORT', 1025), from: required('MAIL_FROM') },
  app: {
    publicUrl: process.env.APP_PUBLIC_URL ?? 'http://127.0.0.1:4173',
    port: integer('APP_PUBLIC_PORT', 4173),
    overduePollSeconds: integer('OVERDUE_POLL_SECONDS', 15),
    dunningFinalNoticeSeconds: integer('DUNNING_FINAL_NOTICE_SECONDS', 259200),
    inviteTtlSeconds: integer('INVITE_TTL_SECONDS', 604800),
  },
};
