// Every service URL, credential and setting, read from the environment once at start.

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

function seconds(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a whole number of seconds`);
  return value;
}

const port = Number(process.env.APP_PUBLIC_PORT ?? 4173);

export const config = {
  port,
  publicUrl: required("APP_PUBLIC_URL").replace(/\/+$/, ""),
  databaseUrl: required("DATABASE_URL"),
  killbill: {
    url: required("KILLBILL_URL").replace(/\/+$/, ""),
    username: required("KILLBILL_USERNAME"),
    password: required("KILLBILL_PASSWORD"),
    apiKey: required("KILLBILL_API_KEY"),
    apiSecret: required("KILLBILL_API_SECRET"),
  },
  smtp: { host: required("SMTP_HOST"), port: Number(required("SMTP_PORT")) },
  mailFrom: process.env.MAIL_FROM ?? "Halyard Hall Box Office <boxoffice@halyardhall.example>",
  holdSeconds: seconds("HOLD_SECONDS", 600),
  offerSeconds: seconds("OFFER_SECONDS", 900),
} as const;
