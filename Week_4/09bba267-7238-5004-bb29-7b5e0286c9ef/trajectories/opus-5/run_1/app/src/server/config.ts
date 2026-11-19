function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') throw new Error(`${name} is not set`);
  return value;
}

function positiveInteger(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive whole number`);
  return value;
}

export interface Config {
  readonly databaseUrl: string;
  readonly killbill: {
    readonly url: string;
    readonly username: string;
    readonly password: string;
    readonly apiKey: string;
    readonly apiSecret: string;
  };
  readonly smtp: { readonly host: string; readonly port: number };
  readonly mailFrom: string;
  readonly port: number;
  readonly publicUrl: string;
  readonly holdSeconds: number;
  readonly offerSeconds: number;
}

function loadConfig(): Config {
  const port = positiveInteger('APP_PUBLIC_PORT', 4173);
  return {
    databaseUrl: required('DATABASE_URL'),
    killbill: {
      url: required('KILLBILL_URL').replace(/\/+$/, ''),
      username: required('KILLBILL_USERNAME'),
      password: required('KILLBILL_PASSWORD'),
      apiKey: required('KILLBILL_API_KEY'),
      apiSecret: required('KILLBILL_API_SECRET'),
    },
    smtp: { host: required('SMTP_HOST'), port: positiveInteger('SMTP_PORT', 1025) },
    mailFrom: required('MAIL_FROM'),
    port,
    publicUrl: (process.env.APP_PUBLIC_URL ?? `http://127.0.0.1:${port}`).replace(/\/+$/, ''),
    holdSeconds: positiveInteger('HOLD_SECONDS', 600),
    offerSeconds: positiveInteger('OFFER_SECONDS', 900),
  };
}

export const config: Config = loadConfig();
