/** The one place the server reads its environment. Nothing here is ever sent to the browser. */

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} must be set`);
  return value;
}

const trimSlash = (url: string): string => url.replace(/\/+$/, "");

const port = Number(process.env.APP_PUBLIC_PORT || "4173");

export const config = {
  port,
  publicUrl: trimSlash(process.env.APP_PUBLIC_URL || `http://localhost:${port}`),
  databaseUrl: required("DATABASE_URL"),
  killbill: {
    url: trimSlash(required("KILLBILL_URL")),
    username: required("KILLBILL_USERNAME"),
    password: required("KILLBILL_PASSWORD"),
    apiKey: required("KILLBILL_API_KEY"),
    apiSecret: required("KILLBILL_API_SECRET"),
  },
  smtp: {
    host: required("SMTP_HOST"),
    port: Number(required("SMTP_PORT")),
    from: required("MAIL_FROM"),
  },
  storage: {
    endpoint: trimSlash(required("S3_ENDPOINT")),
    region: required("S3_REGION"),
    bucket: required("S3_BUCKET"),
    forcePathStyle: required("S3_FORCE_PATH_STYLE") === "true",
    accessKeyId: required("S3_ACCESS_KEY_ID"),
    secretAccessKey: required("S3_SECRET_ACCESS_KEY"),
  },
} as const;
