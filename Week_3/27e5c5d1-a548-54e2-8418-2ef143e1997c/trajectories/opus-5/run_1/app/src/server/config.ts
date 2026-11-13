function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`missing configuration: ${name}`);
  }
  return value;
}

export interface Config {
  port: number;
  databaseUrl: string;
  s3: {
    endpoint: string;
    region: string;
    bucket: string;
    forcePathStyle: boolean;
    accessKeyId: string;
    secretAccessKey: string;
  };
  valkeyUrl: string;
}

export const config: Config = {
  port: Number(process.env.APP_PUBLIC_PORT ?? 4173),
  databaseUrl: required('DATABASE_URL'),
  s3: {
    endpoint: required('S3_ENDPOINT'),
    region: required('S3_REGION'),
    bucket: required('S3_BUCKET'),
    forcePathStyle: (process.env.S3_FORCE_PATH_STYLE ?? 'true') === 'true',
    accessKeyId: required('S3_ACCESS_KEY_ID'),
    secretAccessKey: required('S3_SECRET_ACCESS_KEY'),
  },
  valkeyUrl: required('VALKEY_URL'),
};

export const WORKER_ID = process.env.KINFOLD_WORKER_ID === '2' ? '2' : '1';
export const MAX_JSON_BODY = 65_536;
export const MAX_UPLOAD_BYTES = 10_000_000;
