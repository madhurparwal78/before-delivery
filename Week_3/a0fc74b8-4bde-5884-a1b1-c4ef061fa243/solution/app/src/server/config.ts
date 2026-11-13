const env = process.env;

function required(name: string): string {
  const value = env[name];
  if (value === undefined || value === "") throw new Error(`${name} must be set`);
  return value;
}

function seconds(name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) throw new Error(`${name} must be a whole number of seconds`);
  return value;
}

const port = Number(env["APP_PUBLIC_PORT"] || 4173);

export const config = {
  port,
  publicUrl: required("APP_PUBLIC_URL").replace(/\/+$/, ""),
  databaseUrl: required("DATABASE_URL"),
  s3: {
    endpoint: required("S3_ENDPOINT").replace(/\/+$/, ""),
    region: required("S3_REGION"),
    bucket: required("S3_BUCKET"),
    forcePathStyle: env["S3_FORCE_PATH_STYLE"] !== "false",
    accessKeyId: required("S3_ACCESS_KEY_ID"),
    secretAccessKey: required("S3_SECRET_ACCESS_KEY"),
  },
  smtp: {
    host: required("SMTP_HOST"),
    port: Number(required("SMTP_PORT")),
  },
  mailFrom: env["MAIL_FROM"] || "Undersign <sign@wickmoor.example>",
  gradingKey: env["GRADING_KEY"] || "",
  linkTtlSeconds: seconds("LINK_TTL_SECONDS", 1209600),
  reminderCooldownSeconds: seconds("REMINDER_COOLDOWN_SECONDS", 86400),
  mailRetrySeconds: seconds("MAIL_RETRY_SECONDS", 30),
  sealRetrySeconds: seconds("SEAL_RETRY_SECONDS", 30),
} as const;
