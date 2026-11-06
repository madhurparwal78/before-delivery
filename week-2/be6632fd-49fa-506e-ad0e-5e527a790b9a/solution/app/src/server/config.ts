// The one place the environment is read (brief: Configuration and secrets). Nothing here reaches the browser.

function text(name: string, fallback?: string): string {
  const value = process.env[name];
  if (value !== undefined && value !== "") return value;
  if (fallback !== undefined) return fallback;
  throw new Error(`${name} is not set`);
}

function positive(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? "");
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

const port = positive("APP_PUBLIC_PORT", 4173);

export const config = {
  port,
  publicUrl: text("APP_PUBLIC_URL", `http://127.0.0.1:${port}`).replace(/\/+$/, ""),
  databaseUrl: text("DATABASE_URL"),
  s3: {
    endpoint: text("S3_ENDPOINT").replace(/\/+$/, ""),
    region: text("S3_REGION"),
    bucket: text("S3_BUCKET"),
    forcePathStyle: text("S3_FORCE_PATH_STYLE") === "true",
    accessKeyId: text("S3_ACCESS_KEY_ID"),
    secretAccessKey: text("S3_SECRET_ACCESS_KEY"),
  },
  killbill: {
    url: text("KILLBILL_URL").replace(/\/+$/, ""),
    username: text("KILLBILL_USERNAME"),
    password: text("KILLBILL_PASSWORD"),
    apiKey: text("KILLBILL_API_KEY"),
    apiSecret: text("KILLBILL_API_SECRET"),
  },
  smtp: {
    host: text("SMTP_HOST"),
    port: Number(text("SMTP_PORT")),
  },
  mailFrom: text("MAIL_FROM", "Hourline <launch@hourline.example>"),
  ttl: {
    session: positive("SESSION_TTL_SECONDS", 28_800),
    preview: positive("PREVIEW_LINK_TTL_SECONDS", 604_800),
    optIn: positive("OPT_IN_LINK_TTL_SECONDS", 86_400),
    rateWindow: positive("WAITLIST_RATE_WINDOW_SECONDS", 600),
    invite: positive("INVITE_LINK_TTL_SECONDS", 604_800),
    reset: positive("RESET_LINK_TTL_SECONDS", 3_600),
  },
};
