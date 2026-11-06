export type Config = {
  databaseUrl: string;
  smtpHost: string;
  smtpPort: number;
  mailFrom: string;
  port: number;
  publicUrl: string;
  clockStart: number | null;
  raidFinalizeSeconds: number;
  shieldSeconds: number;
  targetCooldownSeconds: number;
  verifyTokenSeconds: number;
  resetTokenSeconds: number;
  sessionSeconds: number;
  buildTimeDivisor: number;
};

const DEFAULT_MAIL_FROM = 'Saltreach <tides@saltreach.lowtide.test>';
const DEFAULT_PORT = 4173;

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`Missing environment variable ${name}`);
  }
  return value;
}

function numberFrom(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) throw new Error(`Environment variable ${name} is not a number`);
  return parsed;
}

function loadConfig(): Config {
  const port = numberFrom('APP_PUBLIC_PORT', DEFAULT_PORT);
  const clockStartRaw = process.env.SALTREACH_CLOCK_START;
  const clockStart =
    clockStartRaw === undefined || clockStartRaw === '' ? null : Date.parse(clockStartRaw);
  if (clockStart !== null && Number.isNaN(clockStart)) {
    throw new Error('Environment variable SALTREACH_CLOCK_START is not an instant');
  }
  return {
    databaseUrl: required('DATABASE_URL'),
    smtpHost: required('SMTP_HOST'),
    smtpPort: numberFrom('SMTP_PORT', 1025),
    mailFrom: process.env.MAIL_FROM && process.env.MAIL_FROM !== '' ? process.env.MAIL_FROM : DEFAULT_MAIL_FROM,
    port,
    publicUrl:
      process.env.APP_PUBLIC_URL && process.env.APP_PUBLIC_URL !== ''
        ? process.env.APP_PUBLIC_URL.replace(/\/+$/, '')
        : `http://localhost:${port}`,
    clockStart,
    raidFinalizeSeconds: numberFrom('RAID_FINALIZE_SECONDS', 300),
    shieldSeconds: numberFrom('SHIELD_SECONDS', 43200),
    targetCooldownSeconds: numberFrom('TARGET_COOLDOWN_SECONDS', 86400),
    verifyTokenSeconds: numberFrom('VERIFY_TOKEN_SECONDS', 86400),
    resetTokenSeconds: numberFrom('RESET_TOKEN_SECONDS', 1800),
    sessionSeconds: numberFrom('SESSION_SECONDS', 2592000),
    buildTimeDivisor: numberFrom('BUILD_TIME_DIVISOR', 1)
  };
}

export const config: Config = loadConfig();
