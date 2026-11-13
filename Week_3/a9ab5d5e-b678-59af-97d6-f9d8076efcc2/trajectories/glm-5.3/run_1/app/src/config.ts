/** Environment, read only at start. The three published durations are the
 *  only literal fallbacks. */
export interface Config {
  databaseUrl: string;
  smtpHost: string;
  smtpPort: number;
  mailFrom: string;
  s3Endpoint: string;
  s3Region: string;
  s3Bucket: string;
  s3ForcePathStyle: boolean;
  s3AccessKeyId: string;
  s3SecretAccessKey: string;
  gotenbergUrl: string;
  appPublicPort: number;
  appPublicUrl: string;
  answerWindowSeconds: number;
  reminderLeadSeconds: number;
  inviteTtlSeconds: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const port = env.APP_PUBLIC_PORT ? Number(env.APP_PUBLIC_PORT) : 4173;
  return {
    databaseUrl: requireEnv(env, 'DATABASE_URL'),
    smtpHost: env.SMTP_HOST ?? 'mailpit',
    smtpPort: env.SMTP_PORT ? Number(env.SMTP_PORT) : 1025,
    mailFrom: env.MAIL_FROM ?? 'Twohouse <notices@halfwayhollow.test>',
    s3Endpoint: requireEnv(env, 'S3_ENDPOINT'),
    s3Region: env.S3_REGION ?? 'us-east-1',
    s3Bucket: requireEnv(env, 'S3_BUCKET'),
    s3ForcePathStyle: env.S3_FORCE_PATH_STYLE === 'true',
    s3AccessKeyId: requireEnv(env, 'S3_ACCESS_KEY_ID'),
    s3SecretAccessKey: requireEnv(env, 'S3_SECRET_ACCESS_KEY'),
    gotenbergUrl: requireEnv(env, 'GOTENBERG_URL'),
    appPublicPort: port,
    appPublicUrl: env.APP_PUBLIC_URL ?? `http://localhost:${port}`,
    answerWindowSeconds: env.ANSWER_WINDOW_SECONDS ? Number(env.ANSWER_WINDOW_SECONDS) : 172800,
    reminderLeadSeconds: env.REMINDER_LEAD_SECONDS ? Number(env.REMINDER_LEAD_SECONDS) : 21600,
    inviteTtlSeconds: env.INVITE_TTL_SECONDS ? Number(env.INVITE_TTL_SECONDS) : 604800,
  };
}

function requireEnv(env: NodeJS.ProcessEnv, name: string): string {
  const v = env[name];
  if (!v) throw new Error(`Missing ${name}`);
  return v;
}
