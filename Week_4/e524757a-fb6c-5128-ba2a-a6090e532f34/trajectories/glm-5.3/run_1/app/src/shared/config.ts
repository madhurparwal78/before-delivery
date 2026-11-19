export interface Config {
  databaseUrl: string;
  s3: {
    endpoint: string;
    region: string;
    bucket: string;
    forcePathStyle: boolean;
    accessKeyId: string;
    secretAccessKey: string;
  };
  smtp: { host: string; port: number; mailpitUrl: string };
  mailFrom: string;
  appPublicPort: number;
  appPublicUrl: string;
  gradingRoutes: boolean;
  worldTickMs: number;
  worldDayTicks: number;
  duskStartHour: number;
  duskEndHour: number;
  rainStartHour: number;
  rainEndHour: number;
  photoTickGrace: number;
  photoMaxBytes: number;
  liveIntervalMs: number;
  safariSeatReleaseSeconds: number;
  postcardLimit: number;
  postcardWindowSeconds: number;
  confirmCodeTtlSeconds: number;
}

function env(name: string): string {
  return process.env[name] ?? "";
}

function envInt(name: string, dflt: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return dflt;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : dflt;
}

function envBool(name: string, dflt: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined) return dflt;
  return /^(on|1|true|yes)$/i.test(raw);
}

function publicUrl(port: number): string {
  const explicit = env("APP_PUBLIC_URL");
  if (explicit) return explicit.replace(/\/+$/, "");
  return `http://localhost:${port}`;
}

export function loadConfig(): Config {
  const port = envInt("APP_PUBLIC_PORT", 4173);
  return {
    databaseUrl: env("DATABASE_URL"),
    s3: {
      endpoint: env("S3_ENDPOINT"),
      region: env("S3_REGION") || "us-east-1",
      bucket: env("S3_BUCKET"),
      forcePathStyle: envBool("S3_FORCE_PATH_STYLE", true),
      accessKeyId: env("S3_ACCESS_KEY_ID"),
      secretAccessKey: env("S3_SECRET_ACCESS_KEY")
    },
    smtp: {
      host: env("SMTP_HOST"),
      port: envInt("SMTP_PORT", 1025),
      mailpitUrl: env("MAILPIT_URL")
    },
    mailFrom: env("MAIL_FROM") || "Hushfoot <hello@hushfoot.example>",
    appPublicPort: port,
    appPublicUrl: publicUrl(port),
    gradingRoutes: envBool("GRADING_ROUTES", false),
    worldTickMs: envInt("WORLD_TICK_MS", 100),
    worldDayTicks: envInt("WORLD_DAY_TICKS", 14400),
    duskStartHour: envInt("DUSK_START_HOUR", 18),
    duskEndHour: envInt("DUSK_END_HOUR", 20),
    rainStartHour: envInt("RAIN_START_HOUR", 6),
    rainEndHour: envInt("RAIN_END_HOUR", 9),
    photoTickGrace: envInt("PHOTO_TICK_GRACE", 30),
    photoMaxBytes: envInt("PHOTO_MAX_BYTES", 2000000),
    liveIntervalMs: envInt("LIVE_INTERVAL_MS", 1000),
    safariSeatReleaseSeconds: envInt("SAFARI_SEAT_RELEASE_SECONDS", 30),
    postcardLimit: envInt("POSTCARD_LIMIT", 10),
    postcardWindowSeconds: envInt("POSTCARD_WINDOW_SECONDS", 3600),
    confirmCodeTtlSeconds: envInt("CONFIRM_CODE_TTL_SECONDS", 86400)
  };
}
