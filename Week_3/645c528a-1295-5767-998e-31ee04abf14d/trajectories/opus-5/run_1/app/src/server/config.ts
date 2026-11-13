function seconds(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) ? value : fallback;
}

export const config = {
  databaseUrl: process.env.DATABASE_URL ?? '',
  killbill: {
    url: process.env.KILLBILL_URL ?? '',
    username: process.env.KILLBILL_USERNAME ?? '',
    password: process.env.KILLBILL_PASSWORD ?? '',
    apiKey: process.env.KILLBILL_API_KEY ?? '',
    apiSecret: process.env.KILLBILL_API_SECRET ?? '',
  },
  mail: {
    host: process.env.SMTP_HOST ?? '',
    port: seconds('SMTP_PORT', 1025),
    from: process.env.MAIL_FROM ?? 'Long Rail <no-reply@longrail.example>',
  },
  port: seconds('APP_PUBLIC_PORT', 4173),
  publicUrl: process.env.APP_PUBLIC_URL ?? '',
  gradingKey: process.env.GRADING_KEY ?? '',
  shotClockSeconds: seconds('SHOT_CLOCK_SECONDS', 30),
  reconnectGraceSeconds: seconds('RECONNECT_GRACE_SECONDS', 30),
  tournamentWindowSeconds: seconds('TOURNAMENT_WINDOW_SECONDS', 300),
  readyCheckSeconds: seconds('READY_CHECK_SECONDS', 30),
  inviteTtlSeconds: seconds('INVITE_TTL_SECONDS', 900),
};

export function publicOrigin(requestOrigin: string): string {
  return config.publicUrl || requestOrigin;
}
