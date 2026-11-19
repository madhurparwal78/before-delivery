export interface Config {
  port: number;
  databaseUrl: string;
  s3Endpoint: string;
  s3Region: string;
  s3Bucket: string;
  s3ForcePathStyle: boolean;
  s3AccessKeyId: string;
  s3SecretAccessKey: string;
  valkeyUrl: string;
}

function requireEnv (name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value;
}

export function readConfig (): Config {
  return {
    port: Number(process.env.APP_PUBLIC_PORT ?? '4173'),
    databaseUrl: requireEnv('DATABASE_URL'),
    s3Endpoint: requireEnv('S3_ENDPOINT'),
    s3Region: process.env.S3_REGION ?? 'us-east-1',
    s3Bucket: requireEnv('S3_BUCKET'),
    s3ForcePathStyle: (process.env.S3_FORCE_PATH_STYLE ?? 'false').toLowerCase() === 'true',
    s3AccessKeyId: requireEnv('S3_ACCESS_KEY_ID'),
    s3SecretAccessKey: requireEnv('S3_SECRET_ACCESS_KEY'),
    valkeyUrl: requireEnv('VALKEY_URL'),
  };
}
