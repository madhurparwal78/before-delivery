function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') throw new Error(`missing environment variable ${name}`);
  return value;
}

function optional(name: string): string | undefined {
  const value = process.env[name];
  return value === undefined || value === '' ? undefined : value;
}

function wholeSeconds(name: string, fallback: number): number {
  const raw = optional(name);
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`${name} must be whole seconds`);
  return parsed;
}

export interface Config {
  databaseUrl: string;
  killbill: { url: string; username: string; password: string; apiKey: string; apiSecret: string };
  smtp: { host: string; port: number; from: string };
  s3: {
    endpoint: string;
    region: string;
    bucket: string;
    forcePathStyle: boolean;
    accessKeyId: string;
    secretAccessKey: string;
  };
  reservationHoldSeconds: number;
  signingLinkTtlSeconds: number;
  clockStart: string | undefined;
  port: number;
  publicUrl: string;
}

export const config: Config = {
  databaseUrl: required('DATABASE_URL'),
  killbill: {
    url: required('KILLBILL_URL').replace(/\/$/, ''),
    username: required('KILLBILL_USERNAME'),
    password: required('KILLBILL_PASSWORD'),
    apiKey: required('KILLBILL_API_KEY'),
    apiSecret: required('KILLBILL_API_SECRET'),
  },
  smtp: {
    host: required('SMTP_HOST'),
    port: Number(required('SMTP_PORT')),
    from: required('MAIL_FROM'),
  },
  s3: {
    endpoint: required('S3_ENDPOINT').replace(/\/$/, ''),
    region: required('S3_REGION'),
    bucket: required('S3_BUCKET'),
    forcePathStyle: (optional('S3_FORCE_PATH_STYLE') ?? 'true') !== 'false',
    accessKeyId: required('S3_ACCESS_KEY_ID'),
    secretAccessKey: required('S3_SECRET_ACCESS_KEY'),
  },
  reservationHoldSeconds: wholeSeconds('RESERVATION_HOLD_SECONDS', 172800),
  signingLinkTtlSeconds: wholeSeconds('SIGNING_LINK_TTL_SECONDS', 86400),
  clockStart: optional('BELLROLL_CLOCK_START'),
  port: Number(optional('APP_PUBLIC_PORT') ?? 4173),
  publicUrl: (optional('APP_PUBLIC_URL') ?? `http://localhost:${optional('APP_PUBLIC_PORT') ?? 4173}`).replace(
    /\/$/,
    '',
  ),
};
