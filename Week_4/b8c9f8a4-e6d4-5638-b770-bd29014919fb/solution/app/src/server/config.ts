// Every host, credential and time rule is read here, once, from the environment.

function text(name: string, fallback?: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    if (fallback !== undefined) return fallback;
    throw new Error(`${name} is not set`);
  }
  return value;
}

function whole(name: string, fallback: number): number {
  const value = process.env[name];
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${name} must be a whole number of seconds`);
  return parsed;
}

export const config = {
  port: whole('APP_PUBLIC_PORT', 4173),
  databaseUrl: text('DATABASE_URL'),
  store: {
    endpoint: text('S3_ENDPOINT').replace(/\/+$/, ''),
    region: text('S3_REGION'),
    bucket: text('S3_BUCKET'),
    forcePathStyle: text('S3_FORCE_PATH_STYLE') !== 'false',
    accessKeyId: text('S3_ACCESS_KEY_ID'),
    secretAccessKey: text('S3_SECRET_ACCESS_KEY'),
  },
  recordApiUrl: text('WIREMOCK_URL').replace(/\/+$/, ''),
  gotenbergUrl: text('GOTENBERG_URL').replace(/\/+$/, ''),
  ntfy: {
    url: text('NTFY_URL').replace(/\/+$/, ''),
    username: text('NTFY_USERNAME'),
    password: text('NTFY_PASSWORD'),
    topic: 'open-bonnet-owner',
    title: 'Open Bonnet',
  },
  offerLapseSeconds: whole('OFFER_LAPSE_SECONDS', 172800),
  offerWarningSeconds: whole('OFFER_WARNING_SECONDS', 14400),
  linkTtlSeconds: whole('LINK_TTL_SECONDS', 1209600),
  recordPullMaxAgeSeconds: whole('RECORD_PULL_MAX_AGE_SECONDS', 2592000),
} as const;
