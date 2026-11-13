/** Configuration read at start, never hard-coded, never sent to the browser. */

export interface Config {
  port: number;
  databaseUrl: string;
  svixUrl: string;
  svixApiKey: string;
  gotenbergUrl: string;
  amqpUrl: string;
  amqpConnectAddress: string | null;
  meilisearchUrl: string;
  meilisearchApiKey: string;
  s3Endpoint: string;
  s3Region: string;
  s3Bucket: string;
  s3ForcePathStyle: boolean;
  s3AccessKeyId: string;
  s3SecretAccessKey: string;
  minioPublicUrl: string;
  intervalTestClock: boolean;
  endpointAllowedCidrs: string[];
}

function required(name: string): string {
  const v = process.env[name];
  if (!v || !v.trim()) {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return v.trim();
}

function optional(name: string): string | null {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : null;
}

export function loadConfig(): Config {
  const s3Endpoint = required('S3_ENDPOINT');
  return {
    port: Number(optional('APP_PUBLIC_PORT') ?? '4173'),
    databaseUrl: required('DATABASE_URL'),
    svixUrl: required('SVIX_URL'),
    svixApiKey: required('SVIX_API_KEY'),
    gotenbergUrl: required('GOTENBERG_URL'),
    amqpUrl: required('AMQP_URL'),
    amqpConnectAddress: optional('AMQP_CONNECT_ADDRESS'),
    meilisearchUrl: required('MEILISEARCH_URL'),
    meilisearchApiKey: required('MEILISEARCH_API_KEY'),
    s3Endpoint,
    s3Region: required('S3_REGION'),
    s3Bucket: required('S3_BUCKET'),
    s3ForcePathStyle: optional('S3_FORCE_PATH_STYLE') === 'true',
    s3AccessKeyId: required('S3_ACCESS_KEY_ID'),
    s3SecretAccessKey: required('S3_SECRET_ACCESS_KEY'),
    minioPublicUrl: optional('MINIO_PUBLIC_URL') ?? s3Endpoint,
    intervalTestClock: optional('INTERVAL_TEST_CLOCK') === 'on',
    endpointAllowedCidrs: (optional('STOCKIST_ENDPOINT_ALLOWED_CIDRS') ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
  };
}
