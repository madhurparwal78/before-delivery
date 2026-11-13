/** Every service URL and credential is read here, once, from the environment. Nothing outside the server imports this. */
function required(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is not set`)
  return value
}

export const config = {
  port: Number.parseInt(process.env.APP_PUBLIC_PORT ?? '4173', 10),
  databaseUrl: required('DATABASE_URL'),
  s3: {
    endpoint: required('S3_ENDPOINT'),
    region: process.env.S3_REGION ?? 'us-east-1',
    bucket: required('S3_BUCKET'),
    pathStyle: (process.env.S3_FORCE_PATH_STYLE ?? 'true') === 'true',
    accessKeyId: required('S3_ACCESS_KEY_ID'),
    secretAccessKey: required('S3_SECRET_ACCESS_KEY'),
  },
  gotenbergUrl: required('GOTENBERG_URL'),
  seed: process.env.SKINOUT_SEED === 'none' ? ('none' as const) : ('demo' as const),
}
