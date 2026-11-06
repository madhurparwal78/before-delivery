// The one place the environment is read. Values are never logged or sent to the browser.

function env(name: string, fallback = ""): string {
  return process.env[name] ?? fallback;
}

export const config = {
  port: Number(env("APP_PUBLIC_PORT", "4173")) || 4173,
  clockControl: env("APP_CLOCK_CONTROL") === "on",
  databaseUrl: env("DATABASE_URL"),
  s3: {
    endpoint: env("S3_ENDPOINT").replace(/\/+$/, ""),
    region: env("S3_REGION"),
    bucket: env("S3_BUCKET"),
    forcePathStyle: env("S3_FORCE_PATH_STYLE") === "true",
    accessKeyId: env("S3_ACCESS_KEY_ID"),
    secretAccessKey: env("S3_SECRET_ACCESS_KEY"),
  },
  killbill: {
    url: env("KILLBILL_URL").replace(/\/+$/, ""),
    username: env("KILLBILL_USERNAME"),
    password: env("KILLBILL_PASSWORD"),
    apiKey: env("KILLBILL_API_KEY"),
    apiSecret: env("KILLBILL_API_SECRET"),
  },
  smtp: {
    host: env("SMTP_HOST"),
    port: Number(env("SMTP_PORT")),
    from: env("MAIL_FROM"),
  },
} as const;
