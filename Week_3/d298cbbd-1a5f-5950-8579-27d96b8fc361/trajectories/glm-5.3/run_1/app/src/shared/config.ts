// Limits, timers and constants every instance reads from its environment.
export interface AppConfig {
  port: number;
  publicUrl: string;
  gradingKey: string;
  textSeed: number;
  ticketTtlSeconds: number;
  maxLogEvents: number;
  maxTestMs: number;
  fastIntervalMs: number;
  maxExtraLetters: number;
  focusWarningMs: number;
  raceWords: number;
  raceCountdownSeconds: number;
  raceRejoinSeconds: number;
  raceTimeLimitSeconds: number;
  verifyTtlSeconds: number;
  resetTtlSeconds: number;
  mailRetrySeconds: number;
  smtpHost: string;
  smtpPort: number;
  mailFrom: string;
  databaseUrl: string;
  publicBoardRows: number;
  bodyByteLimit: number;
  historyPageSize: number;
  maxRoomSeats: number;
  signAttemptWindowSeconds: number;
  signAttemptMaxFailures: number;
  customMaxCharacters: number;
  customMaxWords: number;
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : fallback;
}

function envString(name: string, fallback: string): string {
  const raw = process.env[name];
  return raw === undefined || raw === '' ? fallback : raw;
}

export function readConfig(): AppConfig {
  return {
    port: envInt('APP_PUBLIC_PORT', 4173),
    publicUrl: envString('APP_PUBLIC_URL', 'http://127.0.0.1:4173'),
    gradingKey: envString('GRADING_KEY', 'holloway-grading-key'),
    textSeed: envInt('TEXT_SEED', 4242),
    ticketTtlSeconds: envInt('TICKET_TTL_SECONDS', 1800),
    maxLogEvents: envInt('MAX_LOG_EVENTS', 12000),
    maxTestMs: envInt('MAX_TEST_MS', 125000),
    fastIntervalMs: envInt('FAST_INTERVAL_MS', 10),
    maxExtraLetters: envInt('MAX_EXTRA_LETTERS', 10),
    focusWarningMs: envInt('FOCUS_WARNING_MS', 1000),
    raceWords: envInt('RACE_WORDS', 15),
    raceCountdownSeconds: envInt('RACE_COUNTDOWN_SECONDS', 3),
    raceRejoinSeconds: envInt('RACE_REJOIN_SECONDS', 30),
    raceTimeLimitSeconds: envInt('RACE_TIME_LIMIT_SECONDS', 120),
    verifyTtlSeconds: envInt('VERIFY_TTL_SECONDS', 86400),
    resetTtlSeconds: envInt('RESET_TTL_SECONDS', 3600),
    mailRetrySeconds: envInt('MAIL_RETRY_SECONDS', 30),
    smtpHost: envString('SMTP_HOST', '127.0.0.1'),
    smtpPort: envInt('SMTP_PORT', 1025),
    mailFrom: envString('MAIL_FROM', 'Strikeproof <proofs@strikeproof.test>'),
    databaseUrl: envString('DATABASE_URL', 'postgresql://localhost:5432/strikeproof'),
    publicBoardRows: 50,
    bodyByteLimit: 1000000,
    historyPageSize: 20,
    maxRoomSeats: 8,
    signAttemptWindowSeconds: 60,
    signAttemptMaxFailures: 5,
    customMaxCharacters: 2000,
    customMaxWords: 400,
  };
}
