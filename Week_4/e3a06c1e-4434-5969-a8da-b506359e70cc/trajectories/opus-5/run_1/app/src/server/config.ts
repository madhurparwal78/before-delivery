const required = (name: string): string => {
  const value = process.env[name];
  if (value === undefined || value === '') throw new Error(`missing environment variable ${name}`);
  return value;
};

const integer = (name: string, fallback: number): number => {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`invalid integer in ${name}`);
  return parsed;
};

export interface Config {
  readonly databaseUrl: string;
  readonly s3: {
    readonly endpoint: string;
    readonly region: string;
    readonly bucket: string;
    readonly forcePathStyle: boolean;
    readonly accessKeyId: string;
    readonly secretAccessKey: string;
  };
  readonly killbill: {
    readonly url: string;
    readonly username: string;
    readonly password: string;
    readonly apiKey: string;
    readonly apiSecret: string;
  };
  readonly idleSeconds: number;
  readonly sessionCapSeconds: number;
  readonly billingPrefix: string;
  readonly port: number;
}

export const config: Config = {
  databaseUrl: required('DATABASE_URL'),
  s3: {
    endpoint: required('S3_ENDPOINT').replace(/\/+$/, ''),
    region: required('S3_REGION'),
    bucket: required('S3_BUCKET'),
    forcePathStyle: (process.env.S3_FORCE_PATH_STYLE ?? 'true').toLowerCase() === 'true',
    accessKeyId: required('S3_ACCESS_KEY_ID'),
    secretAccessKey: required('S3_SECRET_ACCESS_KEY'),
  },
  killbill: {
    url: required('KILLBILL_URL').replace(/\/+$/, ''),
    username: required('KILLBILL_USERNAME'),
    password: required('KILLBILL_PASSWORD'),
    apiKey: required('KILLBILL_API_KEY'),
    apiSecret: required('KILLBILL_API_SECRET'),
  },
  idleSeconds: integer('LOWFIELD_IDLE_SECONDS', 30),
  sessionCapSeconds: integer('LOWFIELD_SESSION_CAP_SECONDS', 3600),
  billingPrefix: process.env.LOWFIELD_BILLING_PREFIX ?? 'lowfield',
  port: integer('APP_PUBLIC_PORT', 4173),
};
