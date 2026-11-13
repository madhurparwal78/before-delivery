/** Every setting is read from the environment at start, never hard-coded. */

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`${name} is not set`);
  }
  return value;
}

function optional(name: string): string | null {
  const value = process.env[name];
  return value === undefined || value === '' ? null : value;
}

function seconds(name: string, fallback: number): number {
  const value = optional(name);
  if (value === null) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a whole number of seconds`);
  }
  return parsed;
}

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
  smtp: { host: string; port: number };
  mailFrom: string;
  port: number;
  publicUrl: string;
  sessionSeconds: number;
  holdSeconds: number;
  portalPageSeconds: number;
  appointmentRateWindowSeconds: number;
  bookFileRateWindowSeconds: number;
}

export function readConfig(): Config {
  const port = Number(optional('APP_PUBLIC_PORT') ?? '4173');
  return {
    databaseUrl: required('DATABASE_URL'),
    s3: {
      endpoint: required('S3_ENDPOINT').replace(/\/+$/, ''),
      region: optional('S3_REGION') ?? 'us-east-1',
      bucket: required('S3_BUCKET'),
      forcePathStyle: (optional('S3_FORCE_PATH_STYLE') ?? 'true') !== 'false',
      accessKeyId: required('S3_ACCESS_KEY_ID'),
      secretAccessKey: required('S3_SECRET_ACCESS_KEY'),
    },
    smtp: {
      host: required('SMTP_HOST'),
      port: Number(optional('SMTP_PORT') ?? '1025'),
    },
    mailFrom: optional('MAIL_FROM') ?? 'Atelier Ourlet <desk@atelier-ourlet.example>',
    port,
    publicUrl: (optional('APP_PUBLIC_URL') ?? `http://localhost:${port}`).replace(/\/+$/, ''),
    sessionSeconds: seconds('SESSION_SECONDS', 43_200),
    holdSeconds: seconds('HOLD_SECONDS', 7_200),
    portalPageSeconds: seconds('PORTAL_PAGE_SECONDS', 1_209_600),
    appointmentRateWindowSeconds: seconds('APPOINTMENT_RATE_WINDOW_SECONDS', 3_600),
    bookFileRateWindowSeconds: seconds('BOOK_FILE_RATE_WINDOW_SECONDS', 3_600),
  };
}
