// The one place the environment is read. Nothing here reaches the browser.

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable ${name}`);
  return value;
}

export interface Config {
  port: number;
  databaseUrl: string;
  s3: {
    endpoint: string;
    region: string;
    bucket: string;
    forcePathStyle: boolean;
    accessKeyId: string;
    secretAccessKey: string;
  };
  smtp: { host: string; port: number; from: string };
}

export function loadConfig(): Config {
  return {
    port: Number(process.env.APP_PUBLIC_PORT || 4173),
    databaseUrl: required("DATABASE_URL"),
    s3: {
      endpoint: required("S3_ENDPOINT").replace(/\/+$/, ""),
      region: required("S3_REGION"),
      bucket: required("S3_BUCKET"),
      forcePathStyle: (process.env.S3_FORCE_PATH_STYLE ?? "").toLowerCase() === "true",
      accessKeyId: required("S3_ACCESS_KEY_ID"),
      secretAccessKey: required("S3_SECRET_ACCESS_KEY"),
    },
    smtp: { host: required("SMTP_HOST"), port: Number(required("SMTP_PORT")), from: required("MAIL_FROM") },
  };
}
