// Configuration read from the environment at start (DP-85). Never sent to the browser.
export const config = {
  databaseUrl: required("DATABASE_URL"),
  publicUrl: (process.env.APP_PUBLIC_URL || `http://localhost:${port()}`).replace(/\/+$/, ""),
  smtp: {
    host: required("SMTP_HOST"),
    port: intEnv("SMTP_PORT", 1025),
    from: process.env.MAIL_FROM || "Mothlight <hello@mothlight.example>",
  },
  s3: {
    endpoint: required("S3_ENDPOINT"),
    region: process.env.S3_REGION || "us-east-1",
    bucket: required("S3_BUCKET"),
    forcePathStyle: (process.env.S3_FORCE_PATH_STYLE || "true") !== "false",
    accessKeyId: required("S3_ACCESS_KEY_ID"),
    secretAccessKey: required("S3_SECRET_ACCESS_KEY"),
  },
  port: port(),
  gradingKey: process.env.GRADING_KEY ?? null,
  startAt: process.env.MOTHLIGHT_START_AT ?? null,
  timeZone: process.env.MOTHLIGHT_TIME_ZONE || "UTC",
  undoSeconds: intEnv("MOTHLIGHT_UNDO_SECONDS", 30),
  inviteTtlSeconds: intEnv("MOTHLIGHT_INVITE_TTL_SECONDS", 604800),
  imageMaxBytes: intEnv("MOTHLIGHT_IMAGE_MAX_BYTES", 10000000),
  imageMaxPixels: intEnv("MOTHLIGHT_IMAGE_MAX_PIXELS", 40000000),
  titleMax: intEnv("MOTHLIGHT_TITLE_MAX", 100),
  descriptionMax: intEnv("MOTHLIGHT_DESCRIPTION_MAX", 500),
  commentMax: intEnv("MOTHLIGHT_COMMENT_MAX", 500),
  boardNameMax: intEnv("MOTHLIGHT_BOARD_NAME_MAX", 50),
};

export const limits = {
  title_max: config.titleMax,
  description_max: config.descriptionMax,
  comment_max: config.commentMax,
  board_name_max: config.boardNameMax,
  image_max_bytes: config.imageMaxBytes,
  image_max_pixels: config.imageMaxPixels,
};

function port(): number {
  return intEnv("APP_PUBLIC_PORT", intEnv("PORT", 4173));
}

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing environment variable ${name}`);
  return v;
}

function intEnv(name: string, dflt: number): number {
  const v = process.env[name];
  if (v === undefined || v === "") return dflt;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : dflt;
}
