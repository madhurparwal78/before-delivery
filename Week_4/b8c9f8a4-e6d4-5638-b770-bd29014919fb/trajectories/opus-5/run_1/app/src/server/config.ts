const required = (name: string): string => {
  const value = process.env[name];
  if (value === undefined || value === '') throw new Error(`Missing environment variable ${name}`);
  return value;
};

const wholeSeconds = (name: string, fallback: number): number => {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${name} must be whole seconds above zero`);
  return parsed;
};

export interface Config {
  databaseUrl: string;
  s3: {
    endpoint: string;
    region: string;
    bucket: string;
    forcePathStyle: boolean;
    accessKeyId: string;
    secretAccessKey: string;
  };
  wiremockUrl: string;
  gotenbergUrl: string;
  ntfy: { url: string; username: string; password: string; topic: string };
  offerLapseSeconds: number;
  offerWarningSeconds: number;
  linkTtlSeconds: number;
  recordPullMaxAgeSeconds: number;
  port: number;
}

export const config: Config = {
  databaseUrl: required('DATABASE_URL'),
  s3: {
    endpoint: required('S3_ENDPOINT'),
    region: required('S3_REGION'),
    bucket: required('S3_BUCKET'),
    forcePathStyle: required('S3_FORCE_PATH_STYLE') === 'true',
    accessKeyId: required('S3_ACCESS_KEY_ID'),
    secretAccessKey: required('S3_SECRET_ACCESS_KEY'),
  },
  wiremockUrl: required('WIREMOCK_URL'),
  gotenbergUrl: required('GOTENBERG_URL'),
  ntfy: {
    url: required('NTFY_URL'),
    username: required('NTFY_USERNAME'),
    password: required('NTFY_PASSWORD'),
    topic: 'open-bonnet-owner',
  },
  offerLapseSeconds: wholeSeconds('OFFER_LAPSE_SECONDS', 172_800),
  offerWarningSeconds: wholeSeconds('OFFER_WARNING_SECONDS', 14_400),
  linkTtlSeconds: wholeSeconds('LINK_TTL_SECONDS', 1_209_600),
  recordPullMaxAgeSeconds: wholeSeconds('RECORD_PULL_MAX_AGE_SECONDS', 2_592_000),
  port: Number(process.env.APP_PUBLIC_PORT ?? 4173),
};
