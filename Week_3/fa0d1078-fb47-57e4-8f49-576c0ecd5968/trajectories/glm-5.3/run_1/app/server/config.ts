// Every setting is read from the environment at start and can be set per
// instance. The value shown is the default.

export interface Config {
  appPort: number;
  mistakeLimit: number;
  hintLimit: number;
  moveLimit: number;
  dailyTz: string;
  dailyStart: string;
  leaderboardSize: number;
  duelCountdownMs: number;
  duelRejoinMs: number;
  duelTieMs: number;
  duelRoomTtlMs: number;
  duelJoinLimit: number;
  verifyTtlMinutes: number;
  resetTtlMinutes: number;
  gradingRoutes: boolean;
  databaseUrl: string;
  valkeyUrl: string;
  smtpHost: string;
  smtpPort: number;
  mailFrom: string;
}

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function str(name: string, fallback: string): string {
  const raw = process.env[name];
  return raw === undefined || raw === '' ? fallback : raw;
}

export function loadConfig(): Config {
  return {
    appPort: num('APP_PUBLIC_PORT', 4173),
    mistakeLimit: num('MISTAKE_LIMIT', 3),
    hintLimit: num('HINT_LIMIT', 3),
    moveLimit: num('MOVE_LIMIT', 5000),
    dailyTz: str('DAILY_TZ', 'Pacific/Auckland'),
    dailyStart: str('DAILY_START', '2026-01-01'),
    leaderboardSize: num('LEADERBOARD_SIZE', 20),
    duelCountdownMs: num('DUEL_COUNTDOWN_MS', 3000),
    duelRejoinMs: num('DUEL_REJOIN_MS', 30000),
    duelTieMs: num('DUEL_TIE_MS', 500),
    duelRoomTtlMs: num('DUEL_ROOM_TTL_MS', 600000),
    duelJoinLimit: num('DUEL_JOIN_LIMIT', 5),
    verifyTtlMinutes: num('VERIFY_TTL_MINUTES', 60),
    resetTtlMinutes: num('RESET_TTL_MINUTES', 30),
    gradingRoutes: str('GRADING_ROUTES', 'on') === 'on',
    databaseUrl: str('DATABASE_URL', 'postgresql://localhost:5432/seam'),
    valkeyUrl: str('VALKEY_URL', 'redis://localhost:6379/0'),
    smtpHost: str('SMTP_HOST', 'localhost'),
    smtpPort: num('SMTP_PORT', 1025),
    mailFrom: str('MAIL_FROM', 'Seam <atelier@seam.example>'),
  };
}

export type ConfigOf = Config;
