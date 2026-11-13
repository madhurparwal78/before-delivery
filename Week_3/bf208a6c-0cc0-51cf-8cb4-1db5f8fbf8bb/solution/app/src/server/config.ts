const env = process.env;

function required(name: string): string {
  const value = env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

function integer(name: string, fallback: number): number {
  const value = env[name];
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`${name} must be a whole number`);
  return parsed;
}

export const config = {
  port: integer("APP_PUBLIC_PORT", 4173),
  publicUrl: required("APP_PUBLIC_URL").replace(/\/+$/, ""),
  databaseUrl: required("DATABASE_URL"),
  s3: {
    endpoint: required("S3_ENDPOINT").replace(/\/+$/, ""),
    region: required("S3_REGION"),
    bucket: required("S3_BUCKET"),
    forcePathStyle: required("S3_FORCE_PATH_STYLE") === "true",
    accessKeyId: required("S3_ACCESS_KEY_ID"),
    secretAccessKey: required("S3_SECRET_ACCESS_KEY"),
  },
  smtp: { host: required("SMTP_HOST"), port: integer("SMTP_PORT", 25), from: required("MAIL_FROM") },
  ntfy: { url: required("NTFY_URL").replace(/\/+$/, ""), username: required("NTFY_USERNAME"), password: required("NTFY_PASSWORD") },
  gradingKey: env["GRADING_KEY"] || null,
  uploadMaxBytes: integer("UPLOAD_MAX_BYTES", 5_000_000),
  verifyCodeTtlSeconds: integer("VERIFY_CODE_TTL_SECONDS", 900),
  inviteTtlSeconds: integer("INVITE_TTL_SECONDS", 604_800),
  jsonLimitBytes: 64_000,
  multipartExtraBytes: 64_000,
};
