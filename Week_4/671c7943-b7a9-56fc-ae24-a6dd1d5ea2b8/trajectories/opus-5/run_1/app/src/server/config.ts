const required = (name: string): string => {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`Missing environment variable ${name}`);
  }
  return value;
};

export const config = {
  databaseUrl: required('DATABASE_URL'),
  smtpHost: required('SMTP_HOST'),
  smtpPort: Number(required('SMTP_PORT')),
  mailFrom: required('MAIL_FROM'),
  studioEmail: required('STUDIO_EMAIL'),
  gotenbergUrl: required('GOTENBERG_URL').replace(/\/+$/, ''),
  gradingKey: process.env.GRADING_KEY ?? null,
  port: Number(process.env.APP_PUBLIC_PORT ?? '4173'),
} as const;
