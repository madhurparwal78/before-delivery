function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`missing configuration: ${name}`);
  return value;
}

export interface Config {
  port: number;
  databaseUrl: string;
  valkeyUrl: string;
  s3: {
    endpoint: string;
    region: string;
    bucket: string;
    forcePathStyle: boolean;
    accessKeyId: string;
    secretAccessKey: string;
  };
}

export function loadConfig(): Config {
  return {
    port: Number(process.env['APP_PUBLIC_PORT'] ?? '4173'),
    databaseUrl: required('DATABASE_URL'),
    valkeyUrl: required('VALKEY_URL'),
    s3: {
      endpoint: required('S3_ENDPOINT').replace(/\/+$/, ''),
      region: required('S3_REGION'),
      bucket: required('S3_BUCKET'),
      forcePathStyle: (process.env['S3_FORCE_PATH_STYLE'] ?? 'true') === 'true',
      accessKeyId: required('S3_ACCESS_KEY_ID'),
      secretAccessKey: required('S3_SECRET_ACCESS_KEY'),
    },
  };
}
