export interface Config {
  port: number;
  databaseUrl: string;
  killbillUrl: string;
  killbillUsername: string;
  killbillPassword: string;
  killbillApiKey: string;
  killbillApiSecret: string;
  smtpHost: string;
  smtpPort: number;
  mailFrom: string;
  publicUrl: string | null;
  publicPort: number | null;
  gradingKey: string | null;
  shotClockSeconds: number;
  reconnectGraceSeconds: number;
  tournamentWindowSeconds: number;
  readyCheckSeconds: number;
  inviteTtlSeconds: number;
  mailTtlSeconds: number;
}

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function loadConfig(): Config {
  return {
    port: intEnv('APP_PUBLIC_PORT', 4173),
    databaseUrl: process.env.DATABASE_URL ?? '',
    killbillUrl: process.env.KILLBILL_URL ?? '',
    killbillUsername: process.env.KILLBILL_USERNAME ?? '',
    killbillPassword: process.env.KILLBILL_PASSWORD ?? '',
    killbillApiKey: process.env.KILLBILL_API_KEY ?? '',
    killbillApiSecret: process.env.KILLBILL_API_SECRET ?? '',
    smtpHost: process.env.SMTP_HOST ?? '',
    smtpPort: intEnv('SMTP_PORT', 1025),
    mailFrom: process.env.MAIL_FROM ?? 'Long Rail <no-reply@longrail.example>',
    publicUrl: process.env.APP_PUBLIC_URL ? process.env.APP_PUBLIC_URL.replace(/\/$/, '') : null,
    publicPort: process.env.APP_PUBLIC_PORT ? intEnv('APP_PUBLIC_PORT', 4173) : null,
    gradingKey: process.env.GRADING_KEY ?? null,
    shotClockSeconds: intEnv('SHOT_CLOCK_SECONDS', 30),
    reconnectGraceSeconds: intEnv('RECONNECT_GRACE_SECONDS', 30),
    tournamentWindowSeconds: intEnv('TOURNAMENT_WINDOW_SECONDS', 300),
    readyCheckSeconds: intEnv('READY_CHECK_SECONDS', 30),
    inviteTtlSeconds: intEnv('INVITE_TTL_SECONDS', 900),
    mailTtlSeconds: intEnv('MAIL_TTL_SECONDS', 900),
  };
}
