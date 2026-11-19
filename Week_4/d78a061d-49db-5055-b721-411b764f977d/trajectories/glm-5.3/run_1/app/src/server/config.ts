const config = {
  databaseUrl: process.env.DATABASE_URL ?? 'postgresql://localhost:5432/linewright',
  s3: {
    endpoint: process.env.S3_ENDPOINT ?? '',
    region: process.env.S3_REGION ?? 'us-east-1',
    bucket: process.env.S3_BUCKET ?? '',
    forcePathStyle: (process.env.S3_FORCE_PATH_STYLE ?? 'true') !== 'false',
    accessKeyId: process.env.S3_ACCESS_KEY_ID ?? '',
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? '',
  },
  smtp: {
    host: process.env.SMTP_HOST ?? '',
    port: Number(process.env.SMTP_PORT ?? 25),
    from: process.env.MAIL_FROM ?? 'Linewright <play@linewright.test>',
  },
  publicUrl: process.env.APP_PUBLIC_URL ?? `http://127.0.0.1:${process.env.APP_PUBLIC_PORT ?? '4173'}`,
  publicPort: Number(process.env.APP_PUBLIC_PORT ?? 4173),
  rejoinGraceSeconds: Number(process.env.REJOIN_GRACE_SECONDS ?? 120),
  mailLinkTtlSeconds: Number(process.env.MAIL_LINK_TTL_SECONDS ?? 1800),
};

export function originOf(url: string): string {
  const u = new URL(url);
  return `${u.protocol}//${u.host}`;
}

export const publicOrigin = originOf(config.publicUrl);

export default config;
