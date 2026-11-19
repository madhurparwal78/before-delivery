// The single place the process environment is read. Nothing here ever reaches the browser.

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} must be set in the environment`);
  return value;
}

function seconds(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive number`);
  return value;
}

export const config = {
  port: Number(process.env.APP_PUBLIC_PORT ?? 4173),
  databaseUrl: required("DATABASE_URL"),
  s3: {
    endpoint: required("S3_ENDPOINT").replace(/\/+$/, ""),
    region: required("S3_REGION"),
    bucket: required("S3_BUCKET"),
    forcePathStyle: required("S3_FORCE_PATH_STYLE") === "true",
    accessKeyId: required("S3_ACCESS_KEY_ID"),
    secretAccessKey: required("S3_SECRET_ACCESS_KEY"),
  },
  smtp: { host: required("SMTP_HOST"), port: Number(required("SMTP_PORT")) },
  mailFrom: process.env.MAIL_FROM ?? "Tramela Estate <encomendas@tramela.example>",
  holdSeconds: seconds("HOLD_SECONDS", 600),
  holdSweepSeconds: seconds("HOLD_SWEEP_SECONDS", 15),
  requestKeyTtlSeconds: seconds("REQUEST_KEY_TTL_SECONDS", 86400),
  sessionSeconds: seconds("SESSION_SECONDS", 43200),
  signInWindowSeconds: seconds("SIGN_IN_WINDOW_SECONDS", 900),
} as const;
