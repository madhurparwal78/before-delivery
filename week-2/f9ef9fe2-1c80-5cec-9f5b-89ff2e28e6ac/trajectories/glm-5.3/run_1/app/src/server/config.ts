export interface Config {
  databaseUrl: string;
  killbillUrl: string;
  killbillUsername: string;
  killbillPassword: string;
  killbillApiKey: string;
  killbillApiSecret: string;
  s3Endpoint: string;
  s3Region: string;
  s3Bucket: string;
  s3ForcePathStyle: boolean;
  s3AccessKeyId: string;
  s3SecretAccessKey: string;
  smtpHost: string;
  smtpPort: number;
  mailFrom: string;
  publicPort: number;
  holdSeconds: number;
}

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`Missing environment variable ${name}`);
  }
  return value;
}

function optional(name: string, fallback: string): string {
  const value = process.env[name];
  return value === undefined || value === "" ? fallback : value;
}

export function readConfig(): Config {
  const holdRaw = optional("PILOTLIGHT_HOLD_SECONDS", "600");
  const holdSeconds = Number.parseInt(holdRaw, 10);
  if (!Number.isInteger(holdSeconds) || holdSeconds < 1 || holdSeconds > 3600) {
    throw new Error("PILOTLIGHT_HOLD_SECONDS must be an integer between 1 and 3600");
  }
  const portRaw = optional("APP_PUBLIC_PORT", "4173");
  const publicPort = Number.parseInt(portRaw, 10);
  if (!Number.isInteger(publicPort) || publicPort < 1 || publicPort > 65535) {
    throw new Error("APP_PUBLIC_PORT must be a valid port");
  }
  return {
    databaseUrl: required("DATABASE_URL"),
    killbillUrl: required("KILLBILL_URL").replace(/\/$/, ""),
    killbillUsername: required("KILLBILL_USERNAME"),
    killbillPassword: required("KILLBILL_PASSWORD"),
    killbillApiKey: required("KILLBILL_API_KEY"),
    killbillApiSecret: required("KILLBILL_API_SECRET"),
    s3Endpoint: optional("S3_ENDPOINT", ""),
    s3Region: optional("S3_REGION", "us-east-1"),
    s3Bucket: optional("S3_BUCKET", ""),
    s3ForcePathStyle: optional("S3_FORCE_PATH_STYLE", "true") === "true",
    s3AccessKeyId: optional("S3_ACCESS_KEY_ID", ""),
    s3SecretAccessKey: optional("S3_SECRET_ACCESS_KEY", ""),
    smtpHost: required("SMTP_HOST"),
    smtpPort: Number.parseInt(optional("SMTP_PORT", "25"), 10),
    mailFrom: optional("MAIL_FROM", "Pilotlight <no-reply@pilotlight.test>"),
    publicPort,
    holdSeconds,
  };
}
