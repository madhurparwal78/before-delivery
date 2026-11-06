// The one module that reads the environment. Values are read once, at start.

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") throw new Error(`Missing required environment variable ${name}`);
  return value;
}

export const config = {
  port: Number(process.env.APP_PUBLIC_PORT || "4173"),
  databaseUrl: required("DATABASE_URL"),
  storage: {
    endpoint: required("S3_ENDPOINT").replace(/\/+$/, ""),
    region: required("S3_REGION"),
    bucket: required("S3_BUCKET"),
    forcePathStyle: required("S3_FORCE_PATH_STYLE").toLowerCase() === "true",
    accessKeyId: required("S3_ACCESS_KEY_ID"),
    secretAccessKey: required("S3_SECRET_ACCESS_KEY"),
  },
  mail: {
    host: required("SMTP_HOST"),
    port: Number(required("SMTP_PORT")),
    from: required("MAIL_FROM"),
  },
} as const;
