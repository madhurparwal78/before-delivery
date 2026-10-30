export const PORT = Number(process.env.APP_PUBLIC_PORT ?? 4173);

export const DATABASE_URL = process.env.DATABASE_URL ?? "";

export const KILLBILL = {
  url: (process.env.KILLBILL_URL ?? "").replace(/\/$/, ""),
  username: process.env.KILLBILL_USERNAME ?? "",
  password: process.env.KILLBILL_PASSWORD ?? "",
  apiKey: process.env.KILLBILL_API_KEY ?? "",
  apiSecret: process.env.KILLBILL_API_SECRET ?? "",
};

export const S3 = {
  endpoint: (process.env.S3_ENDPOINT ?? "").replace(/^https?:\/\//, "").replace(/\/$/, ""),
  region: process.env.S3_REGION ?? "us-east-1",
  bucket: process.env.S3_BUCKET ?? "",
  forcePathStyle: (process.env.S3_FORCE_PATH_STYLE ?? "true") !== "false",
  accessKey: process.env.S3_ACCESS_KEY_ID ?? "",
  secretKey: process.env.S3_SECRET_ACCESS_KEY ?? "",
};

export const SMTP = {
  host: process.env.SMTP_HOST ?? "",
  port: Number(process.env.SMTP_PORT ?? 1025),
  from: process.env.MAIL_FROM ?? "",
};

export const HOLD_TTL_SECONDS = Number(process.env.HOLD_TTL_SECONDS ?? 600);
export const BINDER_LINK_TTL_SECONDS = Number(process.env.BINDER_LINK_TTL_SECONDS ?? 604800);

export const JSON_BODY_LIMIT = 64000;
export const MULTIPART_LIMIT = 5100000;
export const FILE_LIMIT = 5000000;
