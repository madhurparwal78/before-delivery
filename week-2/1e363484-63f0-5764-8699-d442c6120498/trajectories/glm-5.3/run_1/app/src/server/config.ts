/** Every service URL, credential and duration comes from the environment. */

export type Config = {
  databaseUrl: string
  s3: {
    endpoint: string
    region: string
    bucket: string
    forcePathStyle: boolean
    accessKeyId: string
    secretAccessKey: string
  }
  smtp: { host: string; port: number; from: string }
  appPublicUrl: string
  port: number
  linkTtlSeconds: number
  idempotencyTtlSeconds: number
  sessionTtlSeconds: number
}

function intEnv(name: string, def: number): number {
  const raw = process.env[name]
  if (raw === undefined || raw === '') return def
  const n = Number(raw)
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : def
}

export function loadConfig(): Config {
  return {
    databaseUrl: process.env.DATABASE_URL ?? '',
    s3: {
      endpoint: process.env.S3_ENDPOINT ?? '',
      region: process.env.S3_REGION ?? '',
      bucket: process.env.S3_BUCKET ?? '',
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
      accessKeyId: process.env.S3_ACCESS_KEY_ID ?? '',
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? '',
    },
    smtp: {
      host: process.env.SMTP_HOST ?? '',
      port: intEnv('SMTP_PORT', 1025),
      from: process.env.MAIL_FROM ?? 'Fluxseal <seals@sedgemoor.example>',
    },
    appPublicUrl: (process.env.APP_PUBLIC_URL ?? '').replace(/\/+$/, ''),
    port: intEnv('APP_PUBLIC_PORT', 4173),
    linkTtlSeconds: intEnv('LINK_TTL_SECONDS', 2592000),
    idempotencyTtlSeconds: intEnv('IDEMPOTENCY_TTL_SECONDS', 86400),
    sessionTtlSeconds: intEnv('SESSION_TTL_SECONDS', 43200),
  }
}
