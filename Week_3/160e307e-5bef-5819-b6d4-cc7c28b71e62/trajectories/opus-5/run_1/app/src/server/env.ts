function text(name: string, fallback: string): string {
  const value = process.env[name];
  return value === undefined || value === '' ? fallback : value;
}

function optional(name: string): string | null {
  const value = process.env[name];
  return value === undefined || value === '' ? null : value;
}

function integer(name: string, fallback: number): number {
  const value = process.env[name];
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
}

function seat(name: string): 0 | 1 | null {
  const value = process.env[name];
  if (value === '0') return 0;
  if (value === '1') return 1;
  return null;
}

/** Every service address, credential, timer and key is read from the environment here. */
export const env = {
  databaseUrl: text('DATABASE_URL', 'postgresql://postgres@localhost:5432/postgres'),
  smtpHost: text('SMTP_HOST', 'localhost'),
  smtpPort: integer('SMTP_PORT', 1025),
  mailFrom: text('MAIL_FROM', 'Due Coin <signin@duecoin.test>'),
  appPublicUrl: text('APP_PUBLIC_URL', 'http://127.0.0.1:4173'),
  port: integer('APP_PUBLIC_PORT', 4173),
  gradingKey: optional('GRADING_KEY'),
  shotTimerSeconds: integer('SHOT_TIMER_SECONDS', 20),
  reconnectSeconds: integer('RECONNECT_SECONDS', 60),
  bandWidenSeconds: integer('BAND_WIDEN_SECONDS', 5),
  roomExpirySeconds: integer('ROOM_EXPIRY_SECONDS', 600),
  rematchSeconds: integer('REMATCH_SECONDS', 60),
  verdictBannerMs: integer('VERDICT_BANNER_MS', 2000),
  magicLinkSeconds: integer('MAGIC_LINK_SECONDS', 900),
  tossSeed: seat('TOSS_SEED'),
} as const;

/** Only these values ever reach the browser. */
export function publicConfig() {
  return {
    verdictBannerMs: env.verdictBannerMs,
    shotTimerSeconds: env.shotTimerSeconds,
    reconnectSeconds: env.reconnectSeconds,
    rematchSeconds: env.rematchSeconds,
    roomExpirySeconds: env.roomExpirySeconds,
    bandWidenSeconds: env.bandWidenSeconds,
    modelVersion: 'dc-model-1' as const,
  };
}
