function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`Missing environment variable ${name}`);
  }
  return value;
}

function wholeNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`Environment variable ${name} must be a whole number of seconds`);
  }
  return value;
}

const port = wholeNumber('APP_PUBLIC_PORT', 4173);
const publicUrl = (process.env.APP_PUBLIC_URL ?? `http://localhost:${port}`).replace(/\/+$/, '');

export const config = {
  databaseUrl: required('DATABASE_URL'),
  s3: {
    endpoint: required('S3_ENDPOINT').replace(/\/+$/, ''),
    region: required('S3_REGION'),
    bucket: required('S3_BUCKET'),
    forcePathStyle: (process.env.S3_FORCE_PATH_STYLE ?? 'true') !== 'false',
    accessKeyId: required('S3_ACCESS_KEY_ID'),
    secretAccessKey: required('S3_SECRET_ACCESS_KEY'),
  },
  smtp: {
    host: required('SMTP_HOST'),
    port: wholeNumber('SMTP_PORT', 1025),
    from: required('MAIL_FROM'),
  },
  port,
  publicUrl,
  postboxKeyTtlSeconds: wholeNumber('POSTBOX_KEY_TTL_SECONDS', 900),
  rushHoldSeconds: wholeNumber('RUSH_HOLD_SECONDS', 600),
  postcardMailWindowSeconds: wholeNumber('POSTCARD_MAIL_WINDOW_SECONDS', 600),
} as const;

/** The scheme, host and port of `<base>`, lower-cased for origin comparison. */
export const baseOrigin = new URL(config.publicUrl).origin.toLowerCase();

/** Strings describing the machinery that no response may ever contain. */
export const machinery = {
  storeAddress: new URL(config.s3.endpoint).host.toLowerCase(),
  storeHost: new URL(config.s3.endpoint).hostname.toLowerCase(),
  mailAddress: `${config.smtp.host.toLowerCase()}:${config.smtp.port}`,
  mailHost: config.smtp.host.toLowerCase(),
  bucket: config.s3.bucket,
};
