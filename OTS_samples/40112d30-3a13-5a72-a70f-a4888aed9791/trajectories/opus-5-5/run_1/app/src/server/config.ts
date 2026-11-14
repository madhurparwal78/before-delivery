function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") throw new Error(`Missing environment variable ${name}`);
  return value;
}

function optional(name: string): string | null {
  const value = process.env[name];
  return value === undefined || value === "" ? null : value;
}

function positiveInt(name: string): number {
  const value = Number(required(name));
  if (!Number.isInteger(value) || value < 1) throw new Error(`${name} must be a whole number of 1 or more`);
  return value;
}

const port = Number(optional("APP_PUBLIC_PORT") ?? "4173");

export const config = {
  port,
  databaseUrl: required("DATABASE_URL"),
  valkeyUrl: required("VALKEY_URL"),
  s3: {
    endpoint: required("S3_ENDPOINT"),
    region: required("S3_REGION"),
    bucket: required("S3_BUCKET"),
    forcePathStyle: required("S3_FORCE_PATH_STYLE") === "true",
    accessKeyId: required("S3_ACCESS_KEY_ID"),
    secretAccessKey: required("S3_SECRET_ACCESS_KEY"),
  },
  smtpHost: required("SMTP_HOST"),
  smtpPort: Number(required("SMTP_PORT")),
  mailFrom: required("MAIL_FROM"),
  gradingKey: optional("GRADING_KEY"),
  timeZone: required("APP_TZ"),
  baseUrl: (optional("APP_BASE_URL") ?? optional("APP_PUBLIC_URL") ?? `http://localhost:${port}`).replace(/\/+$/, ""),
  resumeTtlHours: positiveInt("RESUME_TTL_HOURS"),
  inviteTtlHours: positiveInt("INVITE_TTL_HOURS"),
  shuffleSeed: required("SHUFFLE_SEED"),
  uploadMaxBytes: positiveInt("UPLOAD_MAX_BYTES"),
  resumeEmailPerHour: positiveInt("RESUME_EMAIL_PER_HOUR"),
  submitPerMinute: positiveInt("SUBMIT_PER_MINUTE"),
  formulaMaxChars: positiveInt("FORMULA_MAX_CHARS"),
  formulaMaxDepth: positiveInt("FORMULA_MAX_DEPTH"),
  exportLinkTtlMinutes: positiveInt("EXPORT_LINK_TTL_MINUTES"),
} as const;
