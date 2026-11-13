// Every service address and credential comes from the environment; the only literals here
// are the three published defaults. Nothing has a fallback.

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
  gotenbergUrl: string;
  wiremockUrl: string;
  techLinkSeconds: number;
  readingStaleSeconds: number;
  maskStepMilliseconds: number;
}

export function readConfig(env: NodeJS.ProcessEnv): Config {
  return {
    port: env.APP_PUBLIC_PORT ? Number(env.APP_PUBLIC_PORT) : 4173,
    databaseUrl: required(env, 'DATABASE_URL'),
    s3: {
      endpoint: required(env, 'S3_ENDPOINT'),
      region: required(env, 'S3_REGION'),
      bucket: required(env, 'S3_BUCKET'),
      forcePathStyle: env.S3_FORCE_PATH_STYLE !== 'false',
      accessKeyId: required(env, 'S3_ACCESS_KEY_ID'),
      secretAccessKey: required(env, 'S3_SECRET_ACCESS_KEY'),
    },
    gotenbergUrl: required(env, 'GOTENBERG_URL'),
    wiremockUrl: required(env, 'WIREMOCK_URL'),
    techLinkSeconds: optionalSeconds(env.TECH_LINK_SECONDS, 1209600),
    readingStaleSeconds: optionalSeconds(env.READING_STALE_SECONDS, 10368000),
    maskStepMilliseconds: optionalSeconds(env.MASK_STEP_MILLISECONDS, 0),
  };
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (value === undefined || value === '') {
    throw new Error(`Missing environment variable ${name}`);
  }
  return value;
}

function optionalSeconds(value: string | undefined, fallback: number): number {
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) return fallback;
  return parsed;
}
