function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

function seconds(name: string, fallback: number): number {
  const value = process.env[name];
  if (!value) return fallback;
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new Error(`${name} is not a number of seconds`);
  return Math.floor(number);
}

export type Config = {
  databaseUrl: string;
  s3: {
    endpoint: string;
    region: string;
    bucket: string;
    forcePathStyle: boolean;
    accessKeyId: string;
    secretAccessKey: string;
  };
  smtp: { host: string; port: number; from: string };
  wiremockUrl: string;
  gotenbergUrl: string;
  ntfy: { url: string; username: string; password: string };
  publicPort: number;
  publicUrl: string;
  publicDeskEmail: string;
  enquiryRateWindowSeconds: number;
  bidWindowSeconds: number;
  quoteValidSeconds: number | null;
  fileRateWindowSeconds: number;
  closureWaitSeconds: number;
  holidayCacheSeconds: number;
  dailyRunAt: string;
  sessionSeconds: number;
};

export function readConfig(): Config {
  const quoteValid = process.env.QUOTE_VALID_SECONDS;
  return {
    databaseUrl: required('DATABASE_URL'),
    s3: {
      endpoint: required('S3_ENDPOINT'),
      region: required('S3_REGION'),
      bucket: required('S3_BUCKET'),
      forcePathStyle: (process.env.S3_FORCE_PATH_STYLE ?? 'true') === 'true',
      accessKeyId: required('S3_ACCESS_KEY_ID'),
      secretAccessKey: required('S3_SECRET_ACCESS_KEY'),
    },
    smtp: { host: required('SMTP_HOST'), port: Number(required('SMTP_PORT')), from: required('MAIL_FROM') },
    wiremockUrl: required('WIREMOCK_URL').replace(/\/$/, ''),
    gotenbergUrl: required('GOTENBERG_URL').replace(/\/$/, ''),
    ntfy: {
      url: required('NTFY_URL').replace(/\/$/, ''),
      username: required('NTFY_USERNAME'),
      password: required('NTFY_PASSWORD'),
    },
    publicPort: Number(process.env.APP_PUBLIC_PORT ?? '4173'),
    publicUrl: (process.env.APP_PUBLIC_URL ?? 'http://127.0.0.1:4173').replace(/\/$/, ''),
    publicDeskEmail: process.env.PUBLIC_DESK_EMAIL ?? 'maria@merrowfield.example',
    enquiryRateWindowSeconds: seconds('ENQUIRY_RATE_WINDOW_SECONDS', 3600),
    bidWindowSeconds: seconds('BID_WINDOW_SECONDS', 172800),
    quoteValidSeconds: quoteValid ? seconds('QUOTE_VALID_SECONDS', 0) : null,
    fileRateWindowSeconds: seconds('FILE_RATE_WINDOW_SECONDS', 3600),
    closureWaitSeconds: seconds('CLOSURE_WAIT_SECONDS', 604800),
    holidayCacheSeconds: seconds('HOLIDAY_CACHE_SECONDS', 86400),
    dailyRunAt: process.env.DAILY_RUN_AT ?? '09:00',
    sessionSeconds: seconds('SESSION_SECONDS', 43200),
  };
}

export const config: Config = readConfig();
