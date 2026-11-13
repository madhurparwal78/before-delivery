function text(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

function whole(name: string, fallback: number): number {
  const raw = process.env[name];
  return raw === undefined || raw === "" ? fallback : Number(raw);
}

/** The only reader of `process.env`: every setting and every service address comes from here. */
export const config = {
  port: whole("APP_PUBLIC_PORT", 4173),
  databaseUrl: text("DATABASE_URL", ""),
  valkeyUrl: text("VALKEY_URL", ""),
  smtpHost: text("SMTP_HOST", ""),
  smtpPort: whole("SMTP_PORT", 1025),
  mailFrom: text("MAIL_FROM", ""),
  rules: {
    mistakeLimit: whole("MISTAKE_LIMIT", 3),
    hintLimit: whole("HINT_LIMIT", 3),
  },
  moveLimit: whole("MOVE_LIMIT", 5000),
  dailyTz: text("DAILY_TZ", "Pacific/Auckland"),
  dailyStart: text("DAILY_START", "2026-01-01"),
  leaderboardSize: whole("LEADERBOARD_SIZE", 20),
  duel: {
    countdownMs: whole("DUEL_COUNTDOWN_MS", 3000),
    rejoinMs: whole("DUEL_REJOIN_MS", 30000),
    tieMs: whole("DUEL_TIE_MS", 500),
    roomTtlMs: whole("DUEL_ROOM_TTL_MS", 600000),
    joinLimit: whole("DUEL_JOIN_LIMIT", 5),
  },
  verifyTtlMinutes: whole("VERIFY_TTL_MINUTES", 60),
  resetTtlMinutes: whole("RESET_TTL_MINUTES", 30),
  gradingRoutes: text("GRADING_ROUTES", "on") === "on",
} as const;
