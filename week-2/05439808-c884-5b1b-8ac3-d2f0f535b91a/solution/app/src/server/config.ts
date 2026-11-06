// Every setting the server reads, read once from the environment at start.

function seconds(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive number`);
  return value;
}

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === '') throw new Error(`${name} is required`);
  return value;
}

const port = Number(process.env.APP_PUBLIC_PORT?.trim() || '4173');
const publicUrl = (process.env.APP_PUBLIC_URL?.trim() || `http://localhost:${port}`).replace(/\/+$/, '');
const clockStart = process.env.SALTREACH_CLOCK_START?.trim();

export const config = {
  databaseUrl: required('DATABASE_URL'),
  smtpHost: required('SMTP_HOST'),
  smtpPort: Number(required('SMTP_PORT')),
  mailFrom: process.env.MAIL_FROM?.trim() || 'Saltreach <tides@saltreach.lowtide.test>',
  port,
  publicUrl,
  publicOrigin: new URL(publicUrl).origin,
  secureCookie: publicUrl.startsWith('https:'),
  clockStart: clockStart ? Date.parse(clockStart) : null,
  finalizeMs: seconds('RAID_FINALIZE_SECONDS', 300) * 1000,
  shieldMs: seconds('SHIELD_SECONDS', 43200) * 1000,
  cooldownMs: seconds('TARGET_COOLDOWN_SECONDS', 86400) * 1000,
  verifyTokenMs: seconds('VERIFY_TOKEN_SECONDS', 86400) * 1000,
  resetTokenMs: seconds('RESET_TOKEN_SECONDS', 1800) * 1000,
  sessionMs: seconds('SESSION_SECONDS', 2592000) * 1000,
  buildTimeDivisor: seconds('BUILD_TIME_DIVISOR', 1),
} as const;

if (config.clockStart !== null && Number.isNaN(config.clockStart)) throw new Error('SALTREACH_CLOCK_START must be an ISO instant');
