// The one module that reads the environment.

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

function seconds(name: string, fallback: number): number {
  return Number(process.env[name] ?? fallback);
}

const port = Number(process.env.APP_PUBLIC_PORT ?? 4173);

export const config = {
  port,
  publicUrl: (process.env.APP_PUBLIC_URL ?? `http://localhost:${port}`).replace(/\/$/, ""),
  databaseUrl: required("DATABASE_URL"),
  s3: {
    endpoint: required("S3_ENDPOINT").replace(/\/$/, ""),
    region: required("S3_REGION"),
    bucket: required("S3_BUCKET"),
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
    accessKeyId: required("S3_ACCESS_KEY_ID"),
    secretAccessKey: required("S3_SECRET_ACCESS_KEY"),
  },
  smtp: { host: required("SMTP_HOST"), port: Number(required("SMTP_PORT")) },
  mailFrom: required("MAIL_FROM"),
  sessionSeconds: seconds("SESSION_SECONDS", 43_200),
  holdSeconds: seconds("HOLD_SECONDS", 7_200),
  portalPageSeconds: seconds("PORTAL_PAGE_SECONDS", 1_209_600),
  appointmentRateWindowSeconds: seconds("APPOINTMENT_RATE_WINDOW_SECONDS", 3_600),
  bookFileRateWindowSeconds: seconds("BOOK_FILE_RATE_WINDOW_SECONDS", 3_600),
};
