function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") throw new Error(`${name} is not set`);
  return value;
}

/** Every credential and service address, read from the environment once. */
export const config = {
  port: Number(process.env["APP_PUBLIC_PORT"] ?? 4173),
  databaseUrl: required("DATABASE_URL"),
  smtpHost: required("SMTP_HOST"),
  smtpPort: Number(required("SMTP_PORT")),
  mailFrom: required("MAIL_FROM"),
  studioEmail: required("STUDIO_EMAIL"),
  gotenbergUrl: required("GOTENBERG_URL"),
  gradingKey: process.env["GRADING_KEY"] || undefined,
} as const;
