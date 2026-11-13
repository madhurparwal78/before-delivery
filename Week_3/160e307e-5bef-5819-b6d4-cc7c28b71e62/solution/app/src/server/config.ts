/** The one place that reads the environment. Nothing here is ever sent to the browser. */

function text(name: string, fallback: string): string {
  const value = process.env[name];
  return value === undefined || value === "" ? fallback : value;
}

function whole(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && process.env[name] !== undefined && process.env[name] !== "" ? value : fallback;
}

function tossSeed(): 0 | 1 | null {
  const value = process.env.TOSS_SEED;
  return value === "0" ? 0 : value === "1" ? 1 : null;
}

const port = whole("APP_PUBLIC_PORT", 4173);

export const config = {
  port,
  publicUrl: text("APP_PUBLIC_URL", `http://127.0.0.1:${port}`).replace(/\/+$/, ""),
  databaseUrl: text("DATABASE_URL", ""),
  smtpHost: text("SMTP_HOST", ""),
  smtpPort: whole("SMTP_PORT", 1025),
  mailFrom: text("MAIL_FROM", "Due Coin <signin@localhost>"),
  gradingKey: text("GRADING_KEY", ""),
  shotTimerSeconds: whole("SHOT_TIMER_SECONDS", 20),
  reconnectSeconds: whole("RECONNECT_SECONDS", 60),
  bandWidenSeconds: whole("BAND_WIDEN_SECONDS", 5),
  roomExpirySeconds: whole("ROOM_EXPIRY_SECONDS", 600),
  rematchSeconds: whole("REMATCH_SECONDS", 60),
  verdictBannerMs: whole("VERDICT_BANNER_MS", 2000),
  magicLinkSeconds: whole("MAGIC_LINK_SECONDS", 900),
  tossSeed: tossSeed(),
} as const;
