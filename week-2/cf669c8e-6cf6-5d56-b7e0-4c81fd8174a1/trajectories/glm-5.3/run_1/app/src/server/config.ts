// Server configuration: read from the environment at start, never sent to the browser.
export interface Config {
  port: number;
  databaseUrl: string;
  killbillUrl: string;
  killbillUsername: string;
  killbillPassword: string;
  killbillApiKey: string;
  killbillApiSecret: string;
  killbillCallbackOrigin: string;
  smtpHost: string;
  smtpPort: number;
  mailFrom: string;
  wiremockUrl: string;
  holdSeconds: number;
  sessionSeconds: number;
  shopClockStart: Date;
  shopClockRate: number;
}

function num(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function readConfig(): Config {
  const port = num(process.env['APP_PUBLIC_PORT'], 4173);
  const callbackOrigin = process.env['KILLBILL_CALLBACK_ORIGIN'] ?? `http://main:${port}`;
  return {
    port,
    databaseUrl: process.env['DATABASE_URL'] ?? 'postgresql://localhost:5432/gf_dev',
    killbillUrl: (process.env['KILLBILL_URL'] ?? 'http://killbill:8080').replace(/\/+$/, ''),
    killbillUsername: process.env['KILLBILL_USERNAME'] ?? 'admin',
    killbillPassword: process.env['KILLBILL_PASSWORD'] ?? 'password',
    killbillApiKey: process.env['KILLBILL_API_KEY'] ?? '',
    killbillApiSecret: process.env['KILLBILL_API_SECRET'] ?? '',
    killbillCallbackOrigin: callbackOrigin.replace(/\/+$/, ''),
    smtpHost: process.env['SMTP_HOST'] ?? 'mailpit',
    smtpPort: num(process.env['SMTP_PORT'], 1025),
    mailFrom: process.env['MAIL_FROM'] ?? 'Ommezwaai Feeler <werkplaats@ommezwaai.example>',
    wiremockUrl: (process.env['WIREMOCK_URL'] ?? 'http://wiremock:8080').replace(/\/+$/, ''),
    holdSeconds: num(process.env['HOLD_SECONDS'], 600),
    sessionSeconds: num(process.env['SESSION_SECONDS'], 43200),
    shopClockStart: process.env['SHOP_CLOCK_START'] ? new Date(process.env['SHOP_CLOCK_START']) : new Date(),
    shopClockRate: num(process.env['SHOP_CLOCK_RATE'], 1),
  };
}
