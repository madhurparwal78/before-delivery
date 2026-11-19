/** Every credential, address and timing setting, read from the environment. */
export interface Config {
  databaseUrl: string;
  s3Endpoint: string;
  s3Region: string;
  s3Bucket: string;
  s3ForcePathStyle: boolean;
  s3AccessKeyId: string;
  s3SecretAccessKey: string;
  smtpHost: string;
  smtpPort: number;
  mailFrom: string;
  wiremockUrl: string;
  gotenbergUrl: string;
  appPublicUrl: string;
  appPublicPort: number;
  sessionSeconds: number;
  answerPageSeconds: number;
  signOffPageSeconds: number;
  reminderAfterSeconds: number;
  requestRateWindowSeconds: number;
  fileRateWindowSeconds: number;
  closureWaitSeconds: number;
}

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const v = Number.parseInt(raw, 10);
  return Number.isFinite(v) ? v : fallback;
}

function strEnv(name: string, fallback: string): string {
  const raw = process.env[name];
  return raw === undefined || raw.trim() === "" ? fallback : raw.trim();
}

export function readConfig(): Config {
  return {
    databaseUrl: strEnv("DATABASE_URL", "postgresql://localhost:5432/fio"),
    s3Endpoint: strEnv("S3_ENDPOINT", "http://localhost:9000"),
    s3Region: strEnv("S3_REGION", "us-east-1"),
    s3Bucket: strEnv("S3_BUCKET", "fio-contado"),
    s3ForcePathStyle: strEnv("S3_FORCE_PATH_STYLE", "true") !== "false",
    s3AccessKeyId: strEnv("S3_ACCESS_KEY_ID", ""),
    s3SecretAccessKey: strEnv("S3_SECRET_ACCESS_KEY", ""),
    smtpHost: strEnv("SMTP_HOST", "localhost"),
    smtpPort: intEnv("SMTP_PORT", 1025),
    mailFrom: strEnv("MAIL_FROM", "Fio Contado Desk <desk@fio-contado.example>"),
    wiremockUrl: strEnv("WIREMOCK_URL", "http://localhost:8080"),
    gotenbergUrl: strEnv("GOTENBERG_URL", "http://localhost:3000"),
    appPublicUrl: strEnv("APP_PUBLIC_URL", "http://127.0.0.1:4173"),
    appPublicPort: intEnv("APP_PUBLIC_PORT", 4173),
    sessionSeconds: intEnv("SESSION_SECONDS", 28800),
    answerPageSeconds: intEnv("ANSWER_PAGE_SECONDS", 1209600),
    signOffPageSeconds: intEnv("SIGN_OFF_PAGE_SECONDS", 1209600),
    reminderAfterSeconds: intEnv("REMINDER_AFTER_SECONDS", 604800),
    requestRateWindowSeconds: intEnv("REQUEST_RATE_WINDOW_SECONDS", 3600),
    fileRateWindowSeconds: intEnv("FILE_RATE_WINDOW_SECONDS", 3600),
    closureWaitSeconds: intEnv("CLOSURE_WAIT_SECONDS", 2592000),
  };
}

export const COOKIE_NAME = "fioSession";
export const JSON_LIMIT = 1_000_000;
export const EVIDENCE_FILE_LIMIT = 5_000_000;
export const EVIDENCE_REQUEST_LIMIT = 10_000_000;
export const PROVIDER_TIMEOUT_MS = 5000;
export const PAGE_SIZE = 25;
export const REQUESTS_PER_WINDOW = 20;
export const DOWNLOADS_PER_WINDOW = 5;
