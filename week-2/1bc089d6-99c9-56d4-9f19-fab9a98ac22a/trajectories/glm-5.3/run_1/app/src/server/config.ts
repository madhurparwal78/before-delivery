export const config = {
  databaseUrl: process.env.DATABASE_URL ?? '',
  smtpHost: process.env.SMTP_HOST ?? 'localhost',
  smtpPort: Number(process.env.SMTP_PORT ?? 1025),
  mailFrom: process.env.MAIL_FROM ?? 'Stillhour <goodnight@stillhour.example>',
  port: Number(process.env.APP_PUBLIC_PORT ?? 4173),
  publicOrigin: process.env.STILLHOUR_PUBLIC_ORIGIN ?? null,
  testClock: process.env.STILLHOUR_TEST_CLOCK === '1',
} as const;
