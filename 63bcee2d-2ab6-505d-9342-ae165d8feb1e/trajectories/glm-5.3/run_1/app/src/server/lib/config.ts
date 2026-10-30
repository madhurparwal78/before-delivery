export interface Config {
  port: number;
  baseUrl: string;
  databaseUrl: string;
  s3: {
    endpoint: string;
    region: string;
    bucket: string;
    forcePathStyle: boolean;
    accessKeyId: string;
    secretAccessKey: string;
  };
  killbill: {
    url: string;
    username: string;
    password: string;
    apiKey: string;
    apiSecret: string;
  };
  smtp: { host: string; port: number };
  timing: {
    tenderLinkTtl: number;
    invitationTtl: number;
    sessionIdleTimeout: number;
    enquiryRateWindow: number;
  };
}

function int(value: string | undefined, fallback: number): number {
  const parsed = value ? parseInt(value, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function loadConfig(): Config {
  const port = int(process.env.APP_PUBLIC_PORT, 4173);
  return {
    port,
    baseUrl: process.env.APP_BASE_URL || `http://localhost:${port}`,
    databaseUrl: process.env.DATABASE_URL || 'postgresql://localhost:5432/plumbline',
    s3: {
      endpoint: process.env.S3_ENDPOINT || 'http://localhost:9000',
      region: process.env.S3_REGION || 'us-east-1',
      bucket: process.env.S3_BUCKET || 'plumbline',
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
      accessKeyId: process.env.S3_ACCESS_KEY_ID || '',
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || '',
    },
    killbill: {
      url: process.env.KILLBILL_URL || 'http://localhost:8080',
      username: process.env.KILLBILL_USERNAME || '',
      password: process.env.KILLBILL_PASSWORD || '',
      apiKey: process.env.KILLBILL_API_KEY || '',
      apiSecret: process.env.KILLBILL_API_SECRET || '',
    },
    smtp: {
      host: process.env.SMTP_HOST || 'localhost',
      port: int(process.env.SMTP_PORT, 1025),
    },
    timing: {
      tenderLinkTtl: int(process.env.TENDER_LINK_TTL_SECONDS, 1800),
      invitationTtl: int(process.env.INVITATION_TTL_SECONDS, 604800),
      sessionIdleTimeout: int(process.env.SESSION_IDLE_TIMEOUT_SECONDS, 43200),
      enquiryRateWindow: int(process.env.ENQUIRY_RATE_WINDOW_SECONDS, 3600),
    },
  };
}
