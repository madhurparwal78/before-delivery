export interface Config {
  readonly port: number;
  readonly databaseUrl: string;
  readonly smtpHost: string;
  readonly smtpPort: number;
  readonly mailFrom: string;
  readonly publicOrigin: string;
  readonly testClockEnabled: boolean;
}

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') throw new Error(`${name} is not set`);
  return value;
}

function readConfig(): Config {
  const port = Number(process.env.APP_PUBLIC_PORT ?? 4173);
  const origin = process.env.STILLHOUR_PUBLIC_ORIGIN;
  return {
    port,
    databaseUrl: required('DATABASE_URL'),
    smtpHost: required('SMTP_HOST'),
    smtpPort: Number(required('SMTP_PORT')),
    mailFrom: required('MAIL_FROM'),
    publicOrigin: origin && origin !== '' ? origin.replace(/\/+$/, '') : `http://localhost:${port}`,
    testClockEnabled: process.env.STILLHOUR_TEST_CLOCK === '1',
  };
}

export const config = readConfig();
