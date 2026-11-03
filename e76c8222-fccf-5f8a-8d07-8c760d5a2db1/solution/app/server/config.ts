// Every setting the server reads from the environment, read once at start.
const env = (name: string): string => process.env[name] ?? "";

const port = Number.parseInt(env("APP_PUBLIC_PORT") || "4173", 10);

export const config = {
  port,
  publicUrl: (env("APP_PUBLIC_URL") || `http://localhost:${port}`).replace(/\/+$/, ""),
  databaseUrl: env("DATABASE_URL"),
  smtp: { host: env("SMTP_HOST"), port: Number.parseInt(env("SMTP_PORT") || "25", 10) },
  mailpitUrl: env("MAILPIT_URL").replace(/\/+$/, ""),
  killbill: {
    url: env("KILLBILL_URL").replace(/\/+$/, ""),
    basicAuth: Buffer.from(`${env("KILLBILL_USERNAME")}:${env("KILLBILL_PASSWORD")}`).toString("base64"),
    apiKey: env("KILLBILL_API_KEY"),
    apiSecret: env("KILLBILL_API_SECRET"),
  },
  s3: {
    endpoint: env("S3_ENDPOINT").replace(/\/+$/, ""),
    region: env("S3_REGION"),
    bucket: env("S3_BUCKET"),
    forcePathStyle: env("S3_FORCE_PATH_STYLE") !== "false",
    accessKeyId: env("S3_ACCESS_KEY_ID"),
    secretAccessKey: env("S3_SECRET_ACCESS_KEY"),
  },
} as const;
