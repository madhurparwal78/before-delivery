export interface AppConfig {
  databaseUrl: string;
  gotenbergUrl: string;
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
  protestWindowSeconds: number;
  appPublicPort: number;
  appPublicUrl: string;
}

export function loadConfig(): AppConfig {
  return {
    databaseUrl: required("DATABASE_URL"),
    gotenbergUrl: required("GOTENBERG_URL"),
    s3: {
      endpoint: required("S3_ENDPOINT"),
      region: required("S3_REGION"),
      bucket: required("S3_BUCKET"),
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
      accessKeyId: required("S3_ACCESS_KEY_ID"),
      secretAccessKey: required("S3_SECRET_ACCESS_KEY"),
    },
    smtp: {
      host: required("SMTP_HOST"),
      port: intOrDefault(process.env.SMTP_PORT, 1025),
    },
    mailFrom: process.env.MAIL_FROM || "Conecount Paddock <paddock@pylonworks.test>",
    protestWindowSeconds: intOrDefault(process.env.PROTEST_WINDOW_SECONDS, 1800),
    appPublicPort: intOrDefault(process.env.APP_PUBLIC_PORT, 4173),
    appPublicUrl: process.env.APP_PUBLIC_URL || "http://localhost:4173",
  };
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

function intOrDefault(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}
