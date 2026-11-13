function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') throw new Error(`Missing environment variable ${name}`);
  return value;
}

function optional(name: string): string | null {
  const value = process.env[name];
  return value === undefined || value === '' ? null : value;
}

export const config = {
  port: Number(process.env.APP_PUBLIC_PORT ?? '4173'),
  databaseUrl: required('DATABASE_URL'),
  svixUrl: required('SVIX_URL'),
  svixApiKey: required('SVIX_API_KEY'),
  gotenbergUrl: required('GOTENBERG_URL'),
  amqpUrl: required('AMQP_URL'),
  amqpConnectAddress: optional('AMQP_CONNECT_ADDRESS'),
  meilisearchUrl: required('MEILISEARCH_URL'),
  meilisearchApiKey: required('MEILISEARCH_API_KEY'),
  s3Endpoint: required('S3_ENDPOINT'),
  s3Region: required('S3_REGION'),
  s3Bucket: required('S3_BUCKET'),
  s3ForcePathStyle: required('S3_FORCE_PATH_STYLE') === 'true',
  s3AccessKeyId: required('S3_ACCESS_KEY_ID'),
  s3SecretAccessKey: required('S3_SECRET_ACCESS_KEY'),
  minioPublicUrl: optional('MINIO_PUBLIC_URL') ?? required('S3_ENDPOINT'),
  testClockEnabled: (optional('INTERVAL_TEST_CLOCK') ?? 'off') === 'on',
  allowedEndpointCidrs: (optional('STOCKIST_ENDPOINT_ALLOWED_CIDRS') ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0),
};
