// Every service URL and credential, read once from the environment (brief: Configuration and secrets).

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") throw new Error(`${name} must be set`);
  return value;
}

const port = Number(process.env.APP_PUBLIC_PORT || 4173);

function mailbox(value: string): string {
  const open = value.indexOf("<");
  return open >= 0 ? value.slice(open + 1, value.indexOf(">", open)).trim() : value.trim();
}

const mailFrom = required("MAIL_FROM");

export const config = {
  port,
  publicUrl: (process.env.APP_PUBLIC_URL || `http://localhost:${port}`).replace(/\/+$/, ""),
  databaseUrl: required("DATABASE_URL"),
  s3: {
    endpoint: required("S3_ENDPOINT").replace(/\/+$/, ""),
    region: required("S3_REGION"),
    bucket: required("S3_BUCKET"),
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
    accessKeyId: required("S3_ACCESS_KEY_ID"),
    secretAccessKey: required("S3_SECRET_ACCESS_KEY"),
  },
  killbill: {
    url: required("KILLBILL_URL").replace(/\/+$/, ""),
    username: required("KILLBILL_USERNAME"),
    password: required("KILLBILL_PASSWORD"),
    apiKey: required("KILLBILL_API_KEY"),
    apiSecret: required("KILLBILL_API_SECRET"),
  },
  smtp: {
    host: required("SMTP_HOST"),
    port: Number(required("SMTP_PORT")),
  },
  mailFrom,
  mailFromAddress: mailbox(mailFrom),
} as const;
