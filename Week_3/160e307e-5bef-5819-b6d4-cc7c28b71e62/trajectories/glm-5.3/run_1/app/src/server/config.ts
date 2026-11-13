/** Configuration read from the environment at start, never hard-coded. */
export interface Config {
  port: number;
  publicUrl: string;
  databaseUrl: string;
  smtpHost: string;
  smtpPort: number;
  mailFrom: string;
  gradingKey: string | null;
  shotTimerSeconds: number;
  reconnectSeconds: number;
  bandWidenSeconds: number;
  roomExpirySeconds: number;
  rematchSeconds: number;
  verdictBannerMs: number;
  magicLinkSeconds: number;
  tossSeed: 0 | 1 | null;
}

function int(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

export function readConfig(): Config {
  const publicPort = process.env.APP_PUBLIC_PORT;
  const port = publicPort !== undefined && publicPort !== ""
    ? Number.parseInt(publicPort, 10)
    : 4173;
  const toss = process.env.TOSS_SEED;
  const tossSeed = toss === "0" ? 0 : toss === "1" ? 1 : null;
  return {
    port,
    publicUrl: process.env.APP_PUBLIC_URL ?? `http://127.0.0.1:${port}`,
    databaseUrl: process.env.DATABASE_URL ?? "",
    smtpHost: process.env.SMTP_HOST ?? "localhost",
    smtpPort: int("SMTP_PORT", 1025),
    mailFrom: process.env.MAIL_FROM ?? "Due Coin <signin@duecoin.test>",
    gradingKey: process.env.GRADING_KEY && process.env.GRADING_KEY.length > 0
      ? process.env.GRADING_KEY
      : null,
    shotTimerSeconds: int("SHOT_TIMER_SECONDS", 20),
    reconnectSeconds: int("RECONNECT_SECONDS", 60),
    bandWidenSeconds: int("BAND_WIDEN_SECONDS", 5),
    roomExpirySeconds: int("ROOM_EXPIRY_SECONDS", 600),
    rematchSeconds: int("REMATCH_SECONDS", 60),
    verdictBannerMs: int("VERDICT_BANNER_MS", 2000),
    magicLinkSeconds: int("MAGIC_LINK_SECONDS", 900),
    tossSeed,
  };
}
