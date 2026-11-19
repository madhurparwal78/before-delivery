import type { ClientConfig } from "../shared/types";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

function optional(name: string, fallback: string): string {
  return process.env[name] || fallback;
}

function wholeNumber(name: string, raw: string): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) throw new Error(`${name} must be a whole number`);
  return value;
}

function wholeRequired(name: string): number {
  return wholeNumber(name, required(name));
}

/** A timer, limit or port with the default the brief gives it. */
function whole(name: string, fallback: number): number {
  const raw = process.env[name];
  return raw ? wholeNumber(name, raw) : fallback;
}

const port = whole("APP_PUBLIC_PORT", 4173);
const publicUrl = required("APP_PUBLIC_URL").replace(/\/+$/, "");

/**
 * Every environment variable, read once at start. Service addresses and credentials have no fallback; only the port,
 * the grading token and the QY_ timers carry the defaults the brief states. Only `client` ever reaches the browser.
 */
export const config = {
  port,
  publicUrl,
  publicOrigin: new URL(publicUrl).origin,
  databaseUrl: required("DATABASE_URL"),
  s3: {
    endpoint: required("S3_ENDPOINT").replace(/\/+$/, ""),
    region: required("S3_REGION"),
    bucket: required("S3_BUCKET"),
    forcePathStyle: required("S3_FORCE_PATH_STYLE") === "true",
    accessKeyId: required("S3_ACCESS_KEY_ID"),
    secretAccessKey: required("S3_SECRET_ACCESS_KEY"),
  },
  smtp: { host: required("SMTP_HOST"), port: wholeRequired("SMTP_PORT"), from: required("MAIL_FROM") },
  gradingToken: optional("GRADING_TOKEN", "qy-grading-local"),
  joinRateLimit: whole("QY_JOIN_RATE_LIMIT", 5),
  verifyTtlSeconds: whole("QY_VERIFY_TTL_SECONDS", 86400),
  client: {
    autosaveMs: whole("QY_AUTOSAVE_MS", 1500),
    blocksStepMs: whole("QY_BLOCKS_STEP_MS", 400),
    simTickMs: whole("QY_SIM_TICK_MS", 100),
    toastMs: whole("QY_TOAST_MS", 4000),
    glancetFadeMs: whole("QY_GLANCET_FADE_MS", 150),
  } satisfies ClientConfig,
};
