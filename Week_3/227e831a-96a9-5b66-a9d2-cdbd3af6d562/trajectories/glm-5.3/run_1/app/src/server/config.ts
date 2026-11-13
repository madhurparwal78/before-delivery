/**
 * Configuration. Every service URL and credential is read from the environment
 * once at start, never hard-coded, never logged and never sent to the browser.
 */

export interface Config {
  readonly databaseUrl: string;
  readonly s3Endpoint: string;
  readonly s3Region: string;
  readonly s3Bucket: string;
  readonly s3ForcePathStyle: boolean;
  readonly s3AccessKeyId: string;
  readonly s3SecretAccessKey: string;
  readonly gotenbergUrl: string;
  readonly seed: 'demo' | 'none';
  readonly port: number;
}

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`Missing configuration: ${name}`);
  }
  return value;
}

export function readConfig(): Config {
  return {
    databaseUrl: required('DATABASE_URL'),
    s3Endpoint: required('S3_ENDPOINT'),
    s3Region: process.env.S3_REGION ?? 'us-east-1',
    s3Bucket: required('S3_BUCKET'),
    s3ForcePathStyle: (process.env.S3_FORCE_PATH_STYLE ?? 'true') === 'true',
    s3AccessKeyId: required('S3_ACCESS_KEY_ID'),
    s3SecretAccessKey: required('S3_SECRET_ACCESS_KEY'),
    gotenbergUrl: required('GOTENBERG_URL'),
    seed: process.env.SKINOUT_SEED === 'none' ? 'none' : 'demo',
    port: Number(process.env.APP_PUBLIC_PORT ?? 4173),
  };
}
