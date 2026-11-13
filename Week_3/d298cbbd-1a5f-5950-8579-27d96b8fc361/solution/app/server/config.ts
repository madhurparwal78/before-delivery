/** Every service address, credential, timer and limit, read from the environment once at start. */

function text(name: string, fallback?: string): string {
  const value = process.env[name];
  if (value !== undefined && value !== "") return value;
  if (fallback === undefined) throw new Error(`${name} is not set`);
  return fallback;
}

function integer(name: string, fallback: number): number {
  const value = Number(text(name, String(fallback)));
  if (!Number.isInteger(value) || value < 0) throw new Error(`${name} must be a non-negative integer`);
  return value;
}

export const config = {
  databaseUrl: text("DATABASE_URL"),
  smtpHost: text("SMTP_HOST"),
  smtpPort: Number(text("SMTP_PORT")),
  mailFrom: text("MAIL_FROM"),
  appPublicUrl: text("APP_PUBLIC_URL").replace(/\/+$/, ""),
  port: integer("APP_PUBLIC_PORT", 4173),
  gradingKey: text("GRADING_KEY", "holloway-grading-key"),
  textSeed: integer("TEXT_SEED", 4242),
  ticketTtlSeconds: integer("TICKET_TTL_SECONDS", 1800),
  maxLogEvents: integer("MAX_LOG_EVENTS", 12000),
  maxTestMs: integer("MAX_TEST_MS", 125000),
  fastIntervalMs: integer("FAST_INTERVAL_MS", 10),
  maxExtraLetters: integer("MAX_EXTRA_LETTERS", 10),
  focusWarningMs: integer("FOCUS_WARNING_MS", 1000),
  raceWords: integer("RACE_WORDS", 15),
  raceCountdownSeconds: integer("RACE_COUNTDOWN_SECONDS", 3),
  raceRejoinSeconds: integer("RACE_REJOIN_SECONDS", 30),
  raceTimeLimitSeconds: integer("RACE_TIME_LIMIT_SECONDS", 120),
  verifyTtlSeconds: integer("VERIFY_TTL_SECONDS", 86400),
  resetTtlSeconds: integer("RESET_TTL_SECONDS", 3600),
  mailRetrySeconds: integer("MAIL_RETRY_SECONDS", 30),
} as const;

/** Limits the brief fixes without a variable. */
export const BODY_LIMIT_BYTES = 1_000_000;
export const ROOM_SEATS = 8;
export const BOARD_ROWS = 50;
export const HISTORY_PAGE_SIZE = 20;
export const SIGN_IN_FAILURES_ALLOWED = 5;
export const SIGN_IN_WINDOW_SECONDS = 60;
export const FAST_GAP_SHARE = 0.3;
