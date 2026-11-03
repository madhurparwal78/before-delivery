function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') throw new Error(`${name} is not set`);
  return value;
}

export interface Config {
  databaseUrl: string;
  smtpHost: string;
  smtpPort: number;
  port: number;
  publicUrl: string;
}

export function loadConfig(): Config {
  const port = Number(process.env.APP_PUBLIC_PORT ?? 4173);
  return {
    databaseUrl: required('DATABASE_URL'),
    smtpHost: required('SMTP_HOST'),
    smtpPort: Number(required('SMTP_PORT')),
    port,
    publicUrl: process.env.APP_PUBLIC_URL ?? `http://localhost:${port}`,
  };
}

export const config: Config = loadConfig();
