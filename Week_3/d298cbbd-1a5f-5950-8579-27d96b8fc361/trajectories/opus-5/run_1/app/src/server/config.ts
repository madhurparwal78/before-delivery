function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') throw new Error(`missing environment variable ${name}`);
  return value;
}

function optional(name: string, fallback: string): string {
  const value = process.env[name];
  return value === undefined || value === '' ? fallback : value;
}

function integer(name: string, fallback: number): number {
  const value = process.env[name];
  if (value === undefined || value === '') return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) throw new Error(`environment variable ${name} is not a number`);
  return parsed;
}

export interface Config {
  readonly databaseUrl: string;
  readonly smtpHost: string;
  readonly smtpPort: number;
  readonly mailFrom: string;
  readonly appPublicUrl: string;
  readonly appPublicPort: number;
  readonly gradingKey: string;
  readonly textSeed: number;
  readonly ticketTtlSeconds: number;
  readonly maxLogEvents: number;
  readonly maxTestMs: number;
  readonly fastIntervalMs: number;
  readonly maxExtraLetters: number;
  readonly focusWarningMs: number;
  readonly raceWords: number;
  readonly raceCountdownSeconds: number;
  readonly raceRejoinSeconds: number;
  readonly raceTimeLimitSeconds: number;
  readonly verifyTtlSeconds: number;
  readonly resetTtlSeconds: number;
  readonly mailRetrySeconds: number;
  readonly maxBodyBytes: number;
}

export function loadConfig(): Config {
  return {
    databaseUrl: required('DATABASE_URL'),
    smtpHost: optional('SMTP_HOST', 'localhost'),
    smtpPort: integer('SMTP_PORT', 1025),
    mailFrom: optional('MAIL_FROM', 'Strikeproof <proofs@strikeproof.test>'),
    appPublicUrl: optional('APP_PUBLIC_URL', 'http://127.0.0.1:4173'),
    appPublicPort: integer('APP_PUBLIC_PORT', 4173),
    gradingKey: optional('GRADING_KEY', 'holloway-grading-key'),
    textSeed: integer('TEXT_SEED', 4242),
    ticketTtlSeconds: integer('TICKET_TTL_SECONDS', 1800),
    maxLogEvents: integer('MAX_LOG_EVENTS', 12000),
    maxTestMs: integer('MAX_TEST_MS', 125000),
    fastIntervalMs: integer('FAST_INTERVAL_MS', 10),
    maxExtraLetters: integer('MAX_EXTRA_LETTERS', 10),
    focusWarningMs: integer('FOCUS_WARNING_MS', 1000),
    raceWords: integer('RACE_WORDS', 15),
    raceCountdownSeconds: integer('RACE_COUNTDOWN_SECONDS', 3),
    raceRejoinSeconds: integer('RACE_REJOIN_SECONDS', 30),
    raceTimeLimitSeconds: integer('RACE_TIME_LIMIT_SECONDS', 120),
    verifyTtlSeconds: integer('VERIFY_TTL_SECONDS', 86400),
    resetTtlSeconds: integer('RESET_TTL_SECONDS', 3600),
    mailRetrySeconds: integer('MAIL_RETRY_SECONDS', 30),
    maxBodyBytes: 1_000_000,
  };
}

export const config = loadConfig();
