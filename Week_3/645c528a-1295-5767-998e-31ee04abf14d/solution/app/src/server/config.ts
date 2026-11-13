/** The one place the environment is read. Every credential comes from here and none has a fallback. */
function seconds(name: string, fallback: number): number {
  const value = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function required(name: string): string {
  return process.env[name] ?? '';
}

export const config = {
  port: seconds('APP_PUBLIC_PORT', 4173),
  publicUrl: process.env.APP_PUBLIC_URL?.replace(/\/$/, '') ?? null,
  databaseUrl: required('DATABASE_URL'),
  killbill: {
    url: required('KILLBILL_URL').replace(/\/$/, ''),
    username: required('KILLBILL_USERNAME'),
    password: required('KILLBILL_PASSWORD'),
    apiKey: required('KILLBILL_API_KEY'),
    apiSecret: required('KILLBILL_API_SECRET'),
  },
  smtp: {
    host: required('SMTP_HOST'),
    port: seconds('SMTP_PORT', 25),
    from: required('MAIL_FROM'),
  },
  gradingKey: process.env.GRADING_KEY ?? null,
  shotClockMs: seconds('SHOT_CLOCK_SECONDS', 30) * 1000,
  reconnectGraceMs: seconds('RECONNECT_GRACE_SECONDS', 30) * 1000,
  tournamentWindowSeconds: seconds('TOURNAMENT_WINDOW_SECONDS', 300),
  readyCheckSeconds: seconds('READY_CHECK_SECONDS', 30),
  inviteTtlSeconds: seconds('INVITE_TTL_SECONDS', 900),
};
