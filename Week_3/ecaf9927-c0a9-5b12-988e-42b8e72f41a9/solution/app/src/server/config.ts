/** The one place the process environment is read. Nothing here is ever sent to the browser. */
function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

export const config = {
  port: Number(process.env['APP_PUBLIC_PORT'] ?? '4173'),
  databaseUrl: required('DATABASE_URL'),
  s3: {
    endpoint: required('S3_ENDPOINT').replace(/\/+$/, ''),
    region: required('S3_REGION'),
    bucket: required('S3_BUCKET'),
    forcePathStyle: process.env['S3_FORCE_PATH_STYLE'] !== 'false',
    accessKeyId: required('S3_ACCESS_KEY_ID'),
    secretAccessKey: required('S3_SECRET_ACCESS_KEY'),
  },
  /** Longest a part save waits for storage before the part is marked Not stored. */
  storageTimeoutMs: 5000,
  /** A storage status answer is reused for this long. */
  storageStatusMaxAgeMs: 5000,
  bodyLimitBytes: 1_000_000,
} as const;
