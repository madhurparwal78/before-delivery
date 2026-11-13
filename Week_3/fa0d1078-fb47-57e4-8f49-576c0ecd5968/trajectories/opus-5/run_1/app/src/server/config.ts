function integer(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value)) throw new Error(`${name} must be a whole number`);
  return value;
}

function text(name: string, fallback: string): string {
  const raw = process.env[name];
  return raw === undefined || raw === '' ? fallback : raw;
}

function required(name: string): string {
  const raw = process.env[name];
  if (raw === undefined || raw === '') throw new Error(`${name} must be set`);
  return raw;
}

export const config = {
  port: integer('APP_PUBLIC_PORT', 4173),
  mistakeLimit: integer('MISTAKE_LIMIT', 3),
  hintLimit: integer('HINT_LIMIT', 3),
  moveLimit: integer('MOVE_LIMIT', 5000),
  dailyTz: text('DAILY_TZ', 'Pacific/Auckland'),
  dailyStart: text('DAILY_START', '2026-01-01'),
  leaderboardSize: integer('LEADERBOARD_SIZE', 20),
  duelCountdownMs: integer('DUEL_COUNTDOWN_MS', 3000),
  duelRejoinMs: integer('DUEL_REJOIN_MS', 30000),
  duelTieMs: integer('DUEL_TIE_MS', 500),
  duelRoomTtlMs: integer('DUEL_ROOM_TTL_MS', 600000),
  duelJoinLimit: integer('DUEL_JOIN_LIMIT', 5),
  verifyTtlMinutes: integer('VERIFY_TTL_MINUTES', 60),
  resetTtlMinutes: integer('RESET_TTL_MINUTES', 30),
  gradingRoutes: text('GRADING_ROUTES', 'on') === 'on',
  databaseUrl: required('DATABASE_URL'),
  valkeyUrl: required('VALKEY_URL'),
  smtpHost: required('SMTP_HOST'),
  smtpPort: integer('SMTP_PORT', 1025),
  mailFrom: text('MAIL_FROM', 'Seam <atelier@seam.example>'),
} as const;

export const BODY_LIMIT_BYTES = 1_000_000;

export const engineLimits = {
  mistakeLimit: config.mistakeLimit,
  hintLimit: config.hintLimit,
};
