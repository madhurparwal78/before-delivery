export type Config = {
  port: number;
  dataDirectory: string;
  killbill: {
    url: string;
    username: string;
    password: string;
    apiKey: string;
    apiSecret: string;
  };
  objectStore: {
    endpoint: string;
    region: string;
    bucket: string;
    forcePathStyle: boolean;
    accessKeyId: string;
    secretAccessKey: string;
  };
  mail: { host: string; port: number; from: string };
  detentionUnitSeconds: number;
};

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') throw new Error(`${name} is not set in the environment`);
  return value;
}

export function loadConfig(): Config {
  const port = Number(process.env.APP_PUBLIC_PORT ?? 4173);
  const detention = process.env.DETENTION_UNIT_SECONDS;
  return {
    port,
    dataDirectory: new URL('../../data/', import.meta.url).pathname,
    killbill: {
      url: required('KILLBILL_URL').replace(/\/$/, ''),
      username: required('KILLBILL_USERNAME'),
      password: required('KILLBILL_PASSWORD'),
      apiKey: required('KILLBILL_API_KEY'),
      apiSecret: required('KILLBILL_API_SECRET'),
    },
    objectStore: {
      endpoint: required('S3_ENDPOINT').replace(/\/$/, ''),
      region: required('S3_REGION'),
      bucket: required('S3_BUCKET'),
      forcePathStyle: required('S3_FORCE_PATH_STYLE') === 'true',
      accessKeyId: required('S3_ACCESS_KEY_ID'),
      secretAccessKey: required('S3_SECRET_ACCESS_KEY'),
    },
    mail: {
      host: required('SMTP_HOST'),
      port: Number(required('SMTP_PORT')),
      from: required('MAIL_FROM'),
    },
    detentionUnitSeconds: detention === undefined ? 1800 : Number(detention),
  };
}
