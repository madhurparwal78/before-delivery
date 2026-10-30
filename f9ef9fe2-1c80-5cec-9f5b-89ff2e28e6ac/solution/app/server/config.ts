// The only module that reads process.env. Values are read once at start and never logged.

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value;
}

function holdSeconds(): number {
  const raw = process.env.PILOTLIGHT_HOLD_SECONDS;
  if (raw === undefined || raw.trim() === "") return 600;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 3600) {
    throw new Error("PILOTLIGHT_HOLD_SECONDS must be a whole number from 1 to 3600");
  }
  return value;
}

export const config = {
  port: Number(process.env.APP_PUBLIC_PORT ?? "4173"),
  databaseUrl: required("DATABASE_URL"),
  holdSeconds: holdSeconds(),
  killbill: {
    url: required("KILLBILL_URL").replace(/\/+$/, ""),
    username: required("KILLBILL_USERNAME"),
    password: required("KILLBILL_PASSWORD"),
    apiKey: required("KILLBILL_API_KEY"),
    apiSecret: required("KILLBILL_API_SECRET"),
  },
  storage: {
    endpoint: required("S3_ENDPOINT").replace(/\/+$/, ""),
    region: required("S3_REGION"),
    bucket: required("S3_BUCKET"),
    forcePathStyle: required("S3_FORCE_PATH_STYLE") === "true",
    accessKeyId: required("S3_ACCESS_KEY_ID"),
    secretAccessKey: required("S3_SECRET_ACCESS_KEY"),
  },
  smtp: {
    host: required("SMTP_HOST"),
    port: Number(required("SMTP_PORT")),
  },
};
