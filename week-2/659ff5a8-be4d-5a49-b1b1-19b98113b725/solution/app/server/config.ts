/** The only reader of the process environment. */

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") throw new Error(`${name} is not set`);
  return value;
}

const port = Number(process.env["APP_PUBLIC_PORT"] ?? "4173");

export const config = {
  port,
  publicUrl: process.env["APP_PUBLIC_URL"] ?? `http://localhost:${port}`,
  databaseUrl: required("DATABASE_URL"),
  gotenbergUrl: required("GOTENBERG_URL"),
  s3: {
    endpoint: required("S3_ENDPOINT"),
    region: required("S3_REGION"),
    bucket: required("S3_BUCKET"),
    forcePathStyle: required("S3_FORCE_PATH_STYLE") === "true",
    accessKeyId: required("S3_ACCESS_KEY_ID"),
    secretAccessKey: required("S3_SECRET_ACCESS_KEY"),
  },
  smtp: { host: required("SMTP_HOST"), port: Number(required("SMTP_PORT")) },
  mailFrom: process.env["MAIL_FROM"] ?? "Conecount Paddock <paddock@pylonworks.test>",
  protestWindowSeconds: Number(process.env["PROTEST_WINDOW_SECONDS"] ?? "1800"),
} as const;
