function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`Missing environment variable ${name}`);
  }
  return value;
}

function optional(name: string, fallback: string): string {
  const value = process.env[name];
  return value === undefined || value === '' ? fallback : value;
}

function seconds(name: string, fallback: number): number {
  const value = process.env[name];
  if (value === undefined || value === '') return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Environment variable ${name} must be a whole number of seconds`);
  }
  return parsed;
}

export interface Config {
  readonly port: number;
  readonly databaseUrl: string;
  readonly s3: {
    readonly endpoint: string;
    readonly region: string;
    readonly bucket: string;
    readonly forcePathStyle: boolean;
    readonly accessKeyId: string;
    readonly secretAccessKey: string;
  };
  readonly killbill: {
    readonly url: string;
    readonly username: string;
    readonly password: string;
    readonly apiKey: string;
    readonly apiSecret: string;
  };
  readonly mail: {
    readonly host: string;
    readonly port: number;
    readonly from: string;
  };
  readonly appPublicUrl: string;
  readonly timers: {
    readonly holdSeconds: number;
    readonly brokerPageSeconds: number;
    readonly manifestPageSeconds: number;
    readonly manifestRetentionSeconds: number;
    readonly sessionSeconds: number;
    readonly brokerRateWindowSeconds: number;
  };
}

export const config: Config = {
  port: Number.parseInt(optional('APP_PUBLIC_PORT', '4173'), 10),
  databaseUrl: required('DATABASE_URL'),
  s3: {
    endpoint: required('S3_ENDPOINT'),
    region: optional('S3_REGION', 'us-east-1'),
    bucket: required('S3_BUCKET'),
    forcePathStyle: optional('S3_FORCE_PATH_STYLE', 'true') === 'true',
    accessKeyId: required('S3_ACCESS_KEY_ID'),
    secretAccessKey: required('S3_SECRET_ACCESS_KEY'),
  },
  killbill: {
    url: required('KILLBILL_URL'),
    username: required('KILLBILL_USERNAME'),
    password: required('KILLBILL_PASSWORD'),
    apiKey: required('KILLBILL_API_KEY'),
    apiSecret: required('KILLBILL_API_SECRET'),
  },
  mail: {
    host: required('SMTP_HOST'),
    port: Number.parseInt(optional('SMTP_PORT', '1025'), 10),
    from: optional('MAIL_FROM', 'Tidewright <bookings@tidewright.example>'),
  },
  appPublicUrl: optional('APP_PUBLIC_URL', 'http://127.0.0.1:4173'),
  timers: {
    holdSeconds: seconds('HOLD_SECONDS', 172800),
    brokerPageSeconds: seconds('BROKER_PAGE_SECONDS', 1209600),
    manifestPageSeconds: seconds('MANIFEST_PAGE_SECONDS', 604800),
    manifestRetentionSeconds: seconds('MANIFEST_RETENTION_SECONDS', 2592000),
    sessionSeconds: seconds('SESSION_SECONDS', 28800),
    brokerRateWindowSeconds: seconds('BROKER_RATE_WINDOW_SECONDS', 600),
  },
};
