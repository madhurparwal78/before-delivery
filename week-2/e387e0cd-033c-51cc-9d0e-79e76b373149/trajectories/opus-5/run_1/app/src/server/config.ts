function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`Missing environment value ${name}`);
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
    throw new Error(`Environment value ${name} must be a positive whole number of seconds`);
  }
  return parsed;
}

export interface Config {
  readonly port: number;
  readonly publicUrl: string;
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
  readonly timers: {
    readonly answerWindowSeconds: number;
    readonly reviewClaimSeconds: number;
    readonly dataRequestPageSeconds: number;
    readonly retentionSeconds: number;
    readonly partnerRateWindowSeconds: number;
    readonly regulatorFileRateWindowSeconds: number;
    readonly sessionSeconds: number;
  };
}

export function loadConfig(): Config {
  const port = Number.parseInt(optional('APP_PUBLIC_PORT', '4173'), 10);
  return {
    port,
    publicUrl: optional('APP_PUBLIC_URL', `http://localhost:${port}`).replace(/\/+$/, ''),
    databaseUrl: required('DATABASE_URL'),
    s3: {
      endpoint: required('S3_ENDPOINT').replace(/\/+$/, ''),
      region: required('S3_REGION'),
      bucket: required('S3_BUCKET'),
      forcePathStyle: optional('S3_FORCE_PATH_STYLE', 'true') === 'true',
      accessKeyId: required('S3_ACCESS_KEY_ID'),
      secretAccessKey: required('S3_SECRET_ACCESS_KEY'),
    },
    killbill: {
      url: required('KILLBILL_URL').replace(/\/+$/, ''),
      username: required('KILLBILL_USERNAME'),
      password: required('KILLBILL_PASSWORD'),
      apiKey: required('KILLBILL_API_KEY'),
      apiSecret: required('KILLBILL_API_SECRET'),
    },
    mail: {
      host: required('SMTP_HOST'),
      port: Number.parseInt(required('SMTP_PORT'), 10),
      from: required('MAIL_FROM'),
    },
    timers: {
      answerWindowSeconds: seconds('ANSWER_WINDOW_SECONDS', 3600),
      reviewClaimSeconds: seconds('REVIEW_CLAIM_SECONDS', 900),
      dataRequestPageSeconds: seconds('DATA_REQUEST_PAGE_SECONDS', 86400),
      retentionSeconds: seconds('RETENTION_SECONDS', 157680000),
      partnerRateWindowSeconds: seconds('PARTNER_RATE_WINDOW_SECONDS', 60),
      regulatorFileRateWindowSeconds: seconds('REGULATOR_FILE_RATE_WINDOW_SECONDS', 600),
      sessionSeconds: seconds('SESSION_SECONDS', 28800),
    },
  };
}

let current: Config | null = null;

export function config(): Config {
  if (current === null) current = loadConfig();
  return current;
}
