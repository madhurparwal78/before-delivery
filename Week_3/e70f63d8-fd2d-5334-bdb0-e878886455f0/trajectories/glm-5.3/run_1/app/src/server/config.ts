// Reads every setting from the environment at start; nothing is hard-coded.

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function str(name: string, fallback: string): string {
  const raw = process.env[name];
  return raw === undefined || raw === "" ? fallback : raw;
}

const required = (name: string): string => {
  const raw = process.env[name];
  if (raw === undefined || raw === "") throw new Error(`Missing required environment variable ${name}`);
  return raw;
};

const port = num("APP_PUBLIC_PORT", 4173);

export const config = {
  port,
  host: "0.0.0.0",
  databaseUrl: required("DATABASE_URL"),
  valkeyUrl: required("VALKEY_URL"),
  s3: {
    endpoint: required("S3_ENDPOINT"),
    region: required("S3_REGION"),
    bucket: required("S3_BUCKET"),
    forcePathStyle: str("S3_FORCE_PATH_STYLE", "true") === "true",
    accessKeyId: required("S3_ACCESS_KEY_ID"),
    secretAccessKey: required("S3_SECRET_ACCESS_KEY"),
  },
  smtp: {
    host: required("SMTP_HOST"),
    port: num("SMTP_PORT", 1025),
  },
  mailFrom: str("MAIL_FROM", "Overcall <scorers@overcall.test>"),
  gradingKey: required("GRADING_KEY"),
  appBaseUrl: str("APP_BASE_URL", str("APP_PUBLIC_URL", `http://localhost:${port}`)),
  appTz: str("APP_TZ", "Asia/Kolkata"),
  liveDelayMs: num("LIVE_DELAY_MS", 3000),
  penGraceMs: num("PEN_GRACE_MS", 2000),
  tickMs: num("TICK_MS", 260),
  tickStaggerMs: num("TICK_STAGGER_MS", 80),
  superOverMax: num("SUPER_OVER_MAX", 2),
  inviteTtlHours: num("INVITE_TTL_HOURS", 48),
  inviteRatePerHour: num("INVITE_RATE_PER_HOUR", 20),
  logoMaxBytes: num("LOGO_MAX_BYTES", 1048576),
  maxJsonBytes: 65536,
  maxLogoRequestBytes: num("LOGO_MAX_BYTES", 1048576) + 65536,
  maxSeedBytes: 1048576,
};
