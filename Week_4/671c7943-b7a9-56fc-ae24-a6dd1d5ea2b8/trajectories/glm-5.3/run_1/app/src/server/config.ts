export interface Config {
  databaseUrl: string;
  smtpHost: string;
  smtpPort: number;
  mailFrom: string;
  studioEmail: string;
  gotenbergUrl: string;
  gradingKey: string | undefined;
  port: number;
}

export function readConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const databaseUrl = env.DATABASE_URL ?? "";
  const smtpHost = env.SMTP_HOST ?? "";
  const smtpPort = Number.parseInt(env.SMTP_PORT ?? "1025", 10);
  const mailFrom = env.MAIL_FROM ?? "";
  const studioEmail = env.STUDIO_EMAIL ?? "";
  const gotenbergUrl = env.GOTENBERG_URL ?? "";
  const gradingKey = env.GRADING_KEY && env.GRADING_KEY.length > 0 ? env.GRADING_KEY : undefined;
  const port = Number.parseInt(env.APP_PUBLIC_PORT ?? "4173", 10);
  return { databaseUrl, smtpHost, smtpPort, mailFrom, studioEmail, gotenbergUrl, gradingKey, port };
}
