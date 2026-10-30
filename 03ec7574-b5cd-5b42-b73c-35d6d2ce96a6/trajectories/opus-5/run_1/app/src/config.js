export const config = {
  databaseUrl: process.env.DATABASE_URL || '',
  publicUrl: process.env.APP_PUBLIC_URL || '',
  port: Number.parseInt(process.env.APP_PUBLIC_PORT || '', 10) || 4173,
  idempotencyRetentionSeconds:
    Number.parseInt(process.env.CORVO_IDEMPOTENCY_RETENTION_SECONDS || '', 10) || 86400
};
