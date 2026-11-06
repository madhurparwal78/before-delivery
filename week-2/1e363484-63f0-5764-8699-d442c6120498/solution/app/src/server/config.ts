// Every service URL, credential and duration the server uses, read once from the environment.
// Literals here are only the brief's documented defaults.

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`missing environment variable ${name}`);
  return value;
}

function wholeNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  if (!/^\d+$/.test(raw)) throw new Error(`${name} must be a whole number`);
  return Number(raw);
}

const DEFAULT_MAIL_FROM = "Fluxseal <seals@sedgemoor.example>";

export const config = {
  port: wholeNumber("APP_PUBLIC_PORT", 4173),
  publicUrl: required("APP_PUBLIC_URL").replace(/\/+$/, ""),
  databaseUrl: required("DATABASE_URL"),
  s3: {
    endpoint: required("S3_ENDPOINT").replace(/\/+$/, ""),
    region: required("S3_REGION"),
    bucket: required("S3_BUCKET"),
    forcePathStyle: (process.env.S3_FORCE_PATH_STYLE ?? "").toLowerCase() === "true",
    accessKeyId: required("S3_ACCESS_KEY_ID"),
    secretAccessKey: required("S3_SECRET_ACCESS_KEY"),
  },
  smtp: {
    host: required("SMTP_HOST"),
    port: Number(required("SMTP_PORT")),
    from: process.env.MAIL_FROM || DEFAULT_MAIL_FROM,
  },
  linkTtlSeconds: wholeNumber("LINK_TTL_SECONDS", 2_592_000),
  idempotencyTtlSeconds: wholeNumber("IDEMPOTENCY_TTL_SECONDS", 86_400),
  sessionTtlSeconds: wholeNumber("SESSION_TTL_SECONDS", 43_200),
} as const;
