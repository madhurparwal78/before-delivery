export interface Config {
  databaseUrl: string;
  smtpHost: string;
  smtpPort: number;
  mailFrom: string;
  gotenbergUrl: string;
  gradingKey: string | null;
  serviceRetrySeconds: number;
  sessionTtlSeconds: number;
  port: number;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} must be set`);
  return value;
}

function integer(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${name} must be a positive integer`);
  return parsed;
}

export const config: Config = {
  databaseUrl: required('DATABASE_URL'),
  smtpHost: required('SMTP_HOST'),
  smtpPort: integer('SMTP_PORT', 1025),
  mailFrom: process.env.MAIL_FROM ?? 'Duefield <reminders@duefield.test>',
  gotenbergUrl: required('GOTENBERG_URL').replace(/\/+$/, ''),
  gradingKey: process.env.GRADING_KEY ? process.env.GRADING_KEY : null,
  serviceRetrySeconds: integer('SERVICE_RETRY_SECONDS', 30),
  sessionTtlSeconds: integer('SESSION_TTL_SECONDS', 604800),
  port: integer('APP_PUBLIC_PORT', 4173),
};
