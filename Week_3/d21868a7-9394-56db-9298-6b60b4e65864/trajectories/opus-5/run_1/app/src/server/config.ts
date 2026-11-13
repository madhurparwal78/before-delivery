/** Every service address and credential, read from the environment once at start. */

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') throw new Error(`Missing environment variable ${name}`);
  return value;
}

export interface Config {
  databaseUrl: string;
  port: number;
  store: {
    endpoint: string;
    region: string;
    bucket: string;
    forcePathStyle: boolean;
    accessKeyId: string;
    secretAccessKey: string;
  };
  mail: {
    host: string;
    port: number;
    from: string;
  };
}

export const config: Config = {
  databaseUrl: required('DATABASE_URL'),
  port: Number(process.env.APP_PUBLIC_PORT ?? '4173'),
  store: {
    endpoint: required('S3_ENDPOINT'),
    region: required('S3_REGION'),
    bucket: required('S3_BUCKET'),
    forcePathStyle: (process.env.S3_FORCE_PATH_STYLE ?? 'true') === 'true',
    accessKeyId: required('S3_ACCESS_KEY_ID'),
    secretAccessKey: required('S3_SECRET_ACCESS_KEY'),
  },
  mail: {
    host: required('SMTP_HOST'),
    port: Number(required('SMTP_PORT')),
    from: required('MAIL_FROM'),
  },
};

export const REGULATOR_EMAIL = 'returns@regulator.example';
