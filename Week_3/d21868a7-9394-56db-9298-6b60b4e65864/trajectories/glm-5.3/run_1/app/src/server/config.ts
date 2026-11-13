// Service settings read once at start from the environment. Values never
// appear in source or in anything sent to the browser.
import { S3Config } from "./s3.ts";
import { SmtpConfig } from "./smtp.ts";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === "") throw new Error(`missing environment variable ${name}`);
  return v.trim();
}

export type AppConfig = {
  databaseUrl: string;
  s3: S3Config;
  smtp: SmtpConfig;
  port: number;
};

export function loadConfig(): AppConfig {
  return {
    databaseUrl: requireEnv("DATABASE_URL"),
    s3: {
      endpoint: requireEnv("S3_ENDPOINT"),
      region: requireEnv("S3_REGION"),
      bucket: requireEnv("S3_BUCKET"),
      forcePathStyle: requireEnv("S3_FORCE_PATH_STYLE").toLowerCase() === "true",
      accessKeyId: requireEnv("S3_ACCESS_KEY_ID"),
      secretAccessKey: requireEnv("S3_SECRET_ACCESS_KEY"),
    },
    smtp: {
      host: requireEnv("SMTP_HOST"),
      port: Number(requireEnv("SMTP_PORT")),
      mailFrom: requireEnv("MAIL_FROM"),
    },
    port: Number(process.env.APP_PUBLIC_PORT || "4173"),
  };
}
