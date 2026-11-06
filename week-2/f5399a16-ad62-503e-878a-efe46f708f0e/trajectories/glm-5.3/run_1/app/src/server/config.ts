// Every credential, address and timer is read from the environment at start,
// never hard-coded, and never reaches the browser.

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
  smtp: {
    host: string;
    port: number;
    from: string;
  };
  wiremockUrl: string;
  gotenbergUrl: string;
  appPublicPort: number;
  appPublicUrl: string;
  timers: {
    sessionSeconds: number;
    undoSeconds: number;
    cueCacheSeconds: number;
    reviewPageSeconds: number;
    signOffPageSeconds: number;
    feePageSeconds: number;
    reminderAfterSeconds: number;
    enquiryRateWindowSeconds: number;
    reviewLinkRateWindowSeconds: number;
    fileRateWindowSeconds: number;
    closureWaitSeconds: number;
  };
};

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function str(name: string, fallback: string): string {
  const raw = process.env[name];
  return raw === undefined || raw === "" ? fallback : raw;
}

export function readConfig(): Config {
  return {
    databaseUrl: str("DATABASE_URL", "postgresql://localhost:5432/clapstick"),
    s3: {
      endpoint: str("S3_ENDPOINT", "http://localhost:9000"),
      region: str("S3_REGION", "us-east-1"),
      bucket: str("S3_BUCKET", "clapstick"),
      forcePathStyle: str("S3_FORCE_PATH_STYLE", "true") !== "false",
      accessKeyId: str("S3_ACCESS_KEY_ID", ""),
      secretAccessKey: str("S3_SECRET_ACCESS_KEY", ""),
    },
    smtp: {
      host: str("SMTP_HOST", "localhost"),
      port: num("SMTP_PORT", 1025),
      from: str("MAIL_FROM", "Noor Bakker Boards <desk@noorbakkerboards.example>"),
    },
    wiremockUrl: str("WIREMOCK_URL", "http://localhost:8080"),
    gotenbergUrl: str("GOTENBERG_URL", "http://localhost:3000"),
    appPublicPort: num("APP_PUBLIC_PORT", 4173),
    appPublicUrl: str("APP_PUBLIC_URL", "http://127.0.0.1:4173"),
    timers: {
      sessionSeconds: num("SESSION_SECONDS", 28800),
      undoSeconds: num("UNDO_SECONDS", 10),
      cueCacheSeconds: num("CUE_CACHE_SECONDS", 300),
      reviewPageSeconds: num("REVIEW_PAGE_SECONDS", 1209600),
      signOffPageSeconds: num("SIGN_OFF_PAGE_SECONDS", 1209600),
      feePageSeconds: num("FEE_PAGE_SECONDS", 1209600),
      reminderAfterSeconds: num("REMINDER_AFTER_SECONDS", 604800),
      enquiryRateWindowSeconds: num("ENQUIRY_RATE_WINDOW_SECONDS", 3600),
      reviewLinkRateWindowSeconds: num("REVIEW_LINK_RATE_WINDOW_SECONDS", 3600),
      fileRateWindowSeconds: num("FILE_RATE_WINDOW_SECONDS", 3600),
      closureWaitSeconds: num("CLOSURE_WAIT_SECONDS", 2592000),
    },
  };
}
