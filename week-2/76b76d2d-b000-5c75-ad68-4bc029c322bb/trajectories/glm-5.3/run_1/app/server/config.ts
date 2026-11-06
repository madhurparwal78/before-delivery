
function intEnv(name: string, def: number, min: number, max: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return def;
  const n = Number.parseInt(raw, 10);
  if (!Number.isInteger(n) || n < min || n > max) return def;
  return n;
}

const port = intEnv('APP_PUBLIC_PORT', 4173, 1, 65535);

export interface Config {
  databaseUrl: string;
  killbillUrl: string;
  killbillUsername: string;
  killbillPassword: string;
  killbillApiKey: string;
  killbillApiSecret: string;
  smtpHost: string;
  smtpPort: number;
  mailFrom: string;
  port: number;
  publicUrl: string;
  holdTtlSeconds: number;
  stepupCodeTtlSeconds: number;
  stepupValidSeconds: number;
  stepupLockoutSeconds: number;
}

export function loadConfig(): Config {
  const portNumber = port;
  const rawPublicUrl = process.env.APP_PUBLIC_URL;
  const publicUrl = (rawPublicUrl !== undefined && rawPublicUrl !== '')
    ? rawPublicUrl.replace(/\/+$/, '')
    : `http://localhost:${portNumber}`;
  const cfg: Config = {
    databaseUrl: process.env.DATABASE_URL ?? '',
    killbillUrl: (process.env.KILLBILL_URL ?? 'http://killbill:8080').replace(/\/+$/, ''),
    killbillUsername: process.env.KILLBILL_USERNAME ?? '',
    killbillPassword: process.env.KILLBILL_PASSWORD ?? '',
    killbillApiKey: process.env.KILLBILL_API_KEY ?? '',
    killbillApiSecret: process.env.KILLBILL_API_SECRET ?? '',
    smtpHost: process.env.SMTP_HOST ?? '',
    smtpPort: intEnv('SMTP_PORT', 1025, 1, 65535),
    mailFrom: process.env.MAIL_FROM ?? 'Halide Box Office <billetterie@halide.example>',
    port: portNumber,
    publicUrl,
    holdTtlSeconds: intEnv('HOLD_TTL_SECONDS', 480, 1, 3600),
    stepupCodeTtlSeconds: intEnv('STEPUP_CODE_TTL_SECONDS', 600, 1, 3600),
    stepupValidSeconds: intEnv('STEPUP_VALID_SECONDS', 600, 1, 3600),
    stepupLockoutSeconds: intEnv('STEPUP_LOCKOUT_SECONDS', 900, 1, 86400),
  };
  return cfg;
}
