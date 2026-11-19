const env = process.env;

function text(name: string): string {
  const value = env[name];
  if (value === undefined || value === "") throw new Error(`${name} is required`);
  return value;
}

function integer(name: string, fallback: number): number {
  const value = env[name];
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${name} must be a positive integer`);
  return parsed;
}

function instant(name: string): Date | null {
  const value = env[name];
  if (value === undefined || value === "") return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error(`${name} must be an ISO 8601 instant`);
  return parsed;
}

function zone(name: string): string {
  const value = env[name] || "UTC";
  new Intl.DateTimeFormat("en-US", { timeZone: value });
  return value;
}

const port = integer("APP_PUBLIC_PORT", integer("PORT", 4173));

export const config = {
  port,
  publicUrl: (env["APP_PUBLIC_URL"] ?? `http://localhost:${port}`).replace(/\/+$/, ""),
  databaseUrl: text("DATABASE_URL"),
  s3: {
    endpoint: text("S3_ENDPOINT"),
    region: env["S3_REGION"] ?? "us-east-1",
    bucket: text("S3_BUCKET"),
    forcePathStyle: (env["S3_FORCE_PATH_STYLE"] ?? "true") === "true",
    accessKeyId: text("S3_ACCESS_KEY_ID"),
    secretAccessKey: text("S3_SECRET_ACCESS_KEY"),
  },
  smtp: { host: text("SMTP_HOST"), port: integer("SMTP_PORT", 1025), from: text("MAIL_FROM") },
  gradingKey: env["GRADING_KEY"] || null,
  startAt: instant("MOTHLIGHT_START_AT"),
  timeZone: zone("MOTHLIGHT_TIME_ZONE"),
  undoSeconds: integer("MOTHLIGHT_UNDO_SECONDS", 30),
  inviteTtlSeconds: integer("MOTHLIGHT_INVITE_TTL_SECONDS", 604800),
  limits: {
    image_max_bytes: integer("MOTHLIGHT_IMAGE_MAX_BYTES", 10_000_000),
    image_max_pixels: integer("MOTHLIGHT_IMAGE_MAX_PIXELS", 40_000_000),
    title_max: integer("MOTHLIGHT_TITLE_MAX", 100),
    description_max: integer("MOTHLIGHT_DESCRIPTION_MAX", 500),
    comment_max: integer("MOTHLIGHT_COMMENT_MAX", 500),
    board_name_max: integer("MOTHLIGHT_BOARD_NAME_MAX", 50),
  },
} as const;

export const JSON_BODY_LIMIT = 65_536;
export const MULTIPART_EXTRA = 65_536;
export const ALT_MAX = 500;
export const SOURCE_MAX = 2048;
export const VARIANT_WIDTHS = [236, 474, 736] as const;
export const FEED_MAX = 60;
export const SEARCH_MAX = 60;
