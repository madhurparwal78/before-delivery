function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

function seconds(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export const config = {
  databaseUrl: required("DATABASE_URL"),
  s3: {
    endpoint: required("S3_ENDPOINT").replace(/\/$/, ""),
    region: required("S3_REGION"),
    bucket: required("S3_BUCKET"),
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== "false",
    accessKeyId: required("S3_ACCESS_KEY_ID"),
    secretAccessKey: required("S3_SECRET_ACCESS_KEY"),
  },
  smtpHost: required("SMTP_HOST"),
  smtpPort: Number(required("SMTP_PORT")),
  mailFrom: required("MAIL_FROM"),
  wiremockUrl: required("WIREMOCK_URL").replace(/\/$/, ""),
  gotenbergUrl: required("GOTENBERG_URL").replace(/\/$/, ""),
  publicUrl: required("APP_PUBLIC_URL").replace(/\/$/, ""),
  port: Number(process.env.APP_PUBLIC_PORT ?? 4173),
  sessionSeconds: seconds("SESSION_SECONDS", 28800),
  answerPageSeconds: seconds("ANSWER_PAGE_SECONDS", 1209600),
  signOffPageSeconds: seconds("SIGN_OFF_PAGE_SECONDS", 1209600),
  reminderAfterSeconds: seconds("REMINDER_AFTER_SECONDS", 604800),
  requestRateWindowSeconds: seconds("REQUEST_RATE_WINDOW_SECONDS", 3600),
  fileRateWindowSeconds: seconds("FILE_RATE_WINDOW_SECONDS", 3600),
  closureWaitSeconds: seconds("CLOSURE_WAIT_SECONDS", 2592000),
};
