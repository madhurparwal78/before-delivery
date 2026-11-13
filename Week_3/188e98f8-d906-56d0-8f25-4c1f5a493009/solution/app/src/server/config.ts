function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") throw new Error(`${name} is not set`);
  return value;
}

function roundSeconds(): number {
  const raw = process.env["ROUND_SECONDS"];
  if (raw === undefined || raw === "") return 240;
  const seconds = Number(raw);
  if (!Number.isInteger(seconds) || seconds < 5 || seconds > 3600) {
    throw new Error("ROUND_SECONDS must be a whole number from 5 to 3600");
  }
  return seconds;
}

/** The only module that reads the environment. */
export const config = {
  port: Number(process.env["APP_PUBLIC_PORT"] ?? "4173"),
  databaseUrl: required("DATABASE_URL"),
  s3: {
    endpoint: required("S3_ENDPOINT").replace(/\/+$/, ""),
    region: required("S3_REGION"),
    bucket: required("S3_BUCKET"),
    forcePathStyle: process.env["S3_FORCE_PATH_STYLE"] !== "false",
    accessKeyId: required("S3_ACCESS_KEY_ID"),
    secretAccessKey: required("S3_SECRET_ACCESS_KEY"),
  },
  smtp: {
    host: required("SMTP_HOST"),
    port: Number(required("SMTP_PORT")),
    from: required("MAIL_FROM"),
  },
  roundSeconds: roundSeconds(),
} as const;
