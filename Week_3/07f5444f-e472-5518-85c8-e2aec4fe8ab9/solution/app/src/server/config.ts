// The one place the server reads its environment. Nothing here reaches the browser.

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") throw new Error(`${name} is not set`);
  return value;
}

function sweepSeconds(): number {
  const value = Number(process.env.REMINDER_SWEEP_SECONDS);
  return Number.isInteger(value) && value >= 1 && value <= 60 ? value : 30;
}

export const config = {
  port: Number(process.env.APP_PUBLIC_PORT) || 4173,
  databaseUrl: required("DATABASE_URL"),
  scoreStore: {
    endpoint: required("S3_ENDPOINT").replace(/\/+$/, ""),
    region: required("S3_REGION"),
    bucket: required("S3_BUCKET"),
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
    accessKeyId: required("S3_ACCESS_KEY_ID"),
    secretAccessKey: required("S3_SECRET_ACCESS_KEY"),
  },
  mail: {
    host: required("SMTP_HOST"),
    port: Number(required("SMTP_PORT")),
    from: required("MAIL_FROM"),
  },
  reminderSweepSeconds: sweepSeconds(),
};
