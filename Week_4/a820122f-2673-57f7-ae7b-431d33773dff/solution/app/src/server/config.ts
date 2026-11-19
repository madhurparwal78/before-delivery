function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value;
}

type Config = {
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
  dayCloseSeconds: number;
};

function loadConfig(): Config {
  const portText = process.env['APP_PUBLIC_PORT'];
  const dayClose = process.env['DAY_CLOSE_SECONDS'];
  return {
    port: portText === undefined || portText === '' ? 4173 : Number(portText),
    databaseUrl: required('DATABASE_URL'),
    s3: {
      endpoint: required('S3_ENDPOINT'),
      region: required('S3_REGION'),
      bucket: required('S3_BUCKET'),
      forcePathStyle: (process.env['S3_FORCE_PATH_STYLE'] ?? 'true') === 'true',
      accessKeyId: required('S3_ACCESS_KEY_ID'),
      secretAccessKey: required('S3_SECRET_ACCESS_KEY'),
    },
    dayCloseSeconds: dayClose === undefined || dayClose === '' ? 172800 : Number(dayClose),
  };
}

export const config: Config = loadConfig();
