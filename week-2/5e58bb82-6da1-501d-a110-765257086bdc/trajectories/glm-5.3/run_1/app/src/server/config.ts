export interface AppConfig {
  port: number;
  publicUrl: string;
  databaseUrl: string;
  s3: {
    endpoint: string;
    region: string;
    bucket: string;
    forcePathStyle: boolean;
    accessKeyId: string;
    secretAccessKey: string;
  };
  smtp: { host: string; port: number; from: string };
  escalationSeconds: number;
  signInWindowSeconds: number;
}

export function loadConfig(): AppConfig {
  const port = Number(process.env.APP_PUBLIC_PORT ?? '4173');
  const publicUrl = (process.env.APP_PUBLIC_URL ?? `http://127.0.0.1:${port}`).replace(/\/+$/, '');
  return {
    port,
    publicUrl,
    databaseUrl: process.env.DATABASE_URL ?? '',
    s3: {
      endpoint: process.env.S3_ENDPOINT ?? '',
      region: process.env.S3_REGION ?? 'us-east-1',
      bucket: process.env.S3_BUCKET ?? '',
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
      accessKeyId: process.env.S3_ACCESS_KEY_ID ?? '',
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? '',
    },
    smtp: {
      host: process.env.SMTP_HOST ?? '',
      port: Number(process.env.SMTP_PORT ?? 25),
      from: process.env.MAIL_FROM ?? 'Swathdeck <alerts@fathomwright.test>',
    },
    escalationSeconds: Number(process.env.ESCALATION_SECONDS ?? '300'),
    signInWindowSeconds: Number(process.env.SIGN_IN_WINDOW_SECONDS ?? '900'),
  };
}

export const config = loadConfig();
