/** Every setting is read from the environment once, here. Nothing in this module is ever logged or sent to the browser. */

function text(name: string, fallback?: string): string {
  const value = process.env[name];
  if (value !== undefined && value !== "") return value;
  if (fallback !== undefined) return fallback;
  throw new Error(`Missing required environment variable ${name}`);
}

function seconds(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a whole number of seconds`);
  return value;
}

const port = Number(text("APP_PUBLIC_PORT", "4173"));

export const config = {
  port,
  publicUrl: text("APP_PUBLIC_URL", `http://localhost:${port}`).replace(/\/+$/, ""),
  databaseUrl: text("DATABASE_URL"),
  s3: {
    endpoint: text("S3_ENDPOINT").replace(/\/+$/, ""),
    region: text("S3_REGION", "us-east-1"),
    bucket: text("S3_BUCKET"),
    forcePathStyle: text("S3_FORCE_PATH_STYLE", "true") === "true",
    accessKeyId: text("S3_ACCESS_KEY_ID"),
    secretAccessKey: text("S3_SECRET_ACCESS_KEY"),
  },
  mail: {
    host: text("SMTP_HOST"),
    port: Number(text("SMTP_PORT", "1025")),
    from: text("MAIL_FROM"),
  },
  timers: {
    sessionIdle: seconds("SESSION_IDLE_SECONDS", 1800),
    sessionAbsolute: seconds("SESSION_ABSOLUTE_SECONDS", 43200),
    signinWindow: seconds("SIGNIN_WINDOW_SECONDS", 900),
    signinLock: seconds("SIGNIN_LOCK_SECONDS", 900),
    inviteTtl: seconds("INVITE_TTL_SECONDS", 259200),
    inviteRateWindow: seconds("INVITE_RATE_WINDOW_SECONDS", 3600),
    inviteLookupWindow: seconds("INVITE_LOOKUP_WINDOW_SECONDS", 600),
    idempotencyKey: seconds("IDEMPOTENCY_KEY_SECONDS", 86400),
    downloadLink: seconds("DOWNLOAD_LINK_SECONDS", 60),
  },
} as const;

export const secureCookies = config.publicUrl.startsWith("https:");
export const sessionCookieName = secureCookies ? "__Host-sw_session" : "sw_session";
