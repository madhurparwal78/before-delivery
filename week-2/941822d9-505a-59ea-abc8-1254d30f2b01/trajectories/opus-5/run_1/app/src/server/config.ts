function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value;
}

function optionalSeconds(name: string): number | null {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return null;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`Environment variable ${name} must be a whole number of seconds`);
  }
  return parsed;
}

export interface Config {
  readonly port: number;
  readonly databaseUrl: string;
  readonly killbill: {
    readonly url: string;
    readonly username: string;
    readonly password: string;
    readonly apiKey: string;
    readonly apiSecret: string;
  };
  readonly s3: {
    readonly endpoint: string;
    readonly region: string;
    readonly bucket: string;
    readonly forcePathStyle: boolean;
    readonly accessKeyId: string;
    readonly secretAccessKey: string;
  };
  readonly mail: {
    readonly host: string;
    readonly port: number;
    readonly from: string;
  };
  readonly seatExpirySeconds: number | null;
  readonly fullRefundWindowSeconds: number;
  readonly shareLinkTtlSeconds: number;
  readonly downloadLinkTtlSeconds: number;
  readonly sealRetrySeconds: number;
}

const SEVEN_DAYS_SECONDS = 7 * 24 * 60 * 60;
const NINETY_DAYS_SECONDS = 90 * 24 * 60 * 60;

export function loadConfig(): Config {
  return {
    port: Number.parseInt(process.env.APP_PUBLIC_PORT ?? '4173', 10),
    databaseUrl: required('DATABASE_URL'),
    killbill: {
      url: required('KILLBILL_URL').replace(/\/+$/, ''),
      username: required('KILLBILL_USERNAME'),
      password: required('KILLBILL_PASSWORD'),
      apiKey: required('KILLBILL_API_KEY'),
      apiSecret: required('KILLBILL_API_SECRET'),
    },
    s3: {
      endpoint: required('S3_ENDPOINT').replace(/\/+$/, ''),
      region: required('S3_REGION'),
      bucket: required('S3_BUCKET'),
      forcePathStyle: required('S3_FORCE_PATH_STYLE') === 'true',
      accessKeyId: required('S3_ACCESS_KEY_ID'),
      secretAccessKey: required('S3_SECRET_ACCESS_KEY'),
    },
    mail: {
      host: required('SMTP_HOST'),
      port: Number.parseInt(required('SMTP_PORT'), 10),
      from: required('MAIL_FROM'),
    },
    seatExpirySeconds: optionalSeconds('CREDWELL_SEAT_EXPIRY_SECONDS'),
    fullRefundWindowSeconds: optionalSeconds('CREDWELL_FULL_REFUND_WINDOW_SECONDS') ?? SEVEN_DAYS_SECONDS,
    shareLinkTtlSeconds: optionalSeconds('CREDWELL_SHARE_LINK_TTL_SECONDS') ?? NINETY_DAYS_SECONDS,
    downloadLinkTtlSeconds: optionalSeconds('CREDWELL_DOWNLOAD_LINK_TTL_SECONDS') ?? SEVEN_DAYS_SECONDS,
    sealRetrySeconds: optionalSeconds('CREDWELL_SEAL_RETRY_SECONDS') ?? 15,
  };
}

export const config = loadConfig();
