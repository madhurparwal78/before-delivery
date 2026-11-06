function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable ${name}`);
  return value;
}

export const config = {
  databaseUrl: required('DATABASE_URL'),
  smtpHost: required('SMTP_HOST'),
  smtpPort: Number(required('SMTP_PORT')),
  mailFrom: required('MAIL_FROM'),
  killbillUrl: required('KILLBILL_URL'),
  killbillUsername: required('KILLBILL_USERNAME'),
  killbillPassword: required('KILLBILL_PASSWORD'),
  killbillApiKey: required('KILLBILL_API_KEY'),
  killbillApiSecret: required('KILLBILL_API_SECRET'),
  appPublicUrl: process.env.APP_PUBLIC_URL ?? 'http://0.0.0.0:4173',
  appPublicPort: Number(process.env.APP_PUBLIC_PORT ?? '4173'),
  clockControl: process.env.CLOCK_CONTROL === 'enabled',
} as const;
