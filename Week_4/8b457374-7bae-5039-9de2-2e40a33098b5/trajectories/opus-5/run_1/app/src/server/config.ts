function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`Missing environment variable ${name}`);
  }
  return value;
}

function integer(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`Environment variable ${name} must be a positive integer`);
  }
  return value;
}

function boolean(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  return raw === 'true' || raw === '1';
}

export interface Config {
  readonly databaseUrl: string;
  readonly killbill: {
    readonly url: string;
    readonly username: string;
    readonly password: string;
    readonly apiKey: string;
    readonly apiSecret: string;
  };
  readonly smtp: { readonly host: string; readonly port: number };
  readonly mailFrom: string;
  readonly s3: {
    readonly endpoint: string;
    readonly region: string;
    readonly bucket: string;
    readonly forcePathStyle: boolean;
    readonly accessKeyId: string;
    readonly secretAccessKey: string;
  };
  readonly gotenbergUrl: string;
  readonly port: number;
  readonly publicUrl: string;
  readonly minCampaignSeconds: number;
  readonly finalWindowSeconds: number;
  readonly fixWindowSeconds: number;
  readonly fixNoticeSeconds: number;
}

/** Every service URL and credential is read from the environment once, at start. */
export const config: Config = {
  databaseUrl: required('DATABASE_URL'),
  killbill: {
    url: required('KILLBILL_URL').replace(/\/+$/, ''),
    username: required('KILLBILL_USERNAME'),
    password: required('KILLBILL_PASSWORD'),
    apiKey: required('KILLBILL_API_KEY'),
    apiSecret: required('KILLBILL_API_SECRET'),
  },
  smtp: { host: required('SMTP_HOST'), port: integer('SMTP_PORT', 1025) },
  mailFrom: required('MAIL_FROM'),
  s3: {
    endpoint: required('S3_ENDPOINT').replace(/\/+$/, ''),
    region: required('S3_REGION'),
    bucket: required('S3_BUCKET'),
    forcePathStyle: boolean('S3_FORCE_PATH_STYLE', true),
    accessKeyId: required('S3_ACCESS_KEY_ID'),
    secretAccessKey: required('S3_SECRET_ACCESS_KEY'),
  },
  gotenbergUrl: required('GOTENBERG_URL').replace(/\/+$/, ''),
  port: integer('APP_PUBLIC_PORT', 4173),
  publicUrl: required('APP_PUBLIC_URL').replace(/\/+$/, ''),
  minCampaignSeconds: integer('MIN_CAMPAIGN_SECONDS', 86_400),
  finalWindowSeconds: integer('FINAL_WINDOW_SECONDS', 86_400),
  fixWindowSeconds: integer('FIX_WINDOW_SECONDS', 604_800),
  fixNoticeSeconds: integer('FIX_NOTICE_SECONDS', 172_800),
};

/** The longest a campaign may run, from the launch instant. */
export const MAX_CAMPAIGN_SECONDS = 5_184_000;
