import { DEFAULT_LIMITS, type Limits } from '../shared/domain.ts'

function text(name: string, fallback: string): string {
  const value = process.env[name]
  return value === undefined || value === '' ? fallback : value
}

function whole(name: string, fallback: number): number {
  const value = Number(text(name, String(fallback)))
  return Number.isInteger(value) && value >= 0 ? value : fallback
}

const port = whole('APP_PUBLIC_PORT', 4173)

interface Config {
  port: number
  publicUrl: string
  databaseUrl: string
  storage: {
    endpoint: string
    region: string
    bucket: string
    forcePathStyle: boolean
    accessKeyId: string
    secretAccessKey: string
  }
  smtp: { host: string; port: number }
  mailFrom: string
  gradingKey: string
  parseDelayMs: number
  liveMaxDelayMs: number
  presenceTimeoutSeconds: number
  codeTtlSeconds: number
  shareTtlSeconds: number
  exportLinkTtlSeconds: number
  exportRateLimit: number
  limits: Limits
  timeZone: string
}

/** The one place the server reads its environment. */
export const config: Config = {
  port,
  publicUrl: text('APP_PUBLIC_URL', `http://localhost:${port}`).replace(/\/$/, ''),
  databaseUrl: text('DATABASE_URL', ''),
  storage: {
    endpoint: text('S3_ENDPOINT', '').replace(/\/$/, ''),
    region: text('S3_REGION', 'us-east-1'),
    bucket: text('S3_BUCKET', ''),
    forcePathStyle: text('S3_FORCE_PATH_STYLE', 'true') === 'true',
    accessKeyId: text('S3_ACCESS_KEY_ID', ''),
    secretAccessKey: text('S3_SECRET_ACCESS_KEY', ''),
  },
  smtp: { host: text('SMTP_HOST', ''), port: whole('SMTP_PORT', 1025) },
  mailFrom: text('MAIL_FROM', ''),
  gradingKey: text('JOINERY_GRADING_KEY', ''),
  parseDelayMs: whole('JOINERY_PARSE_DELAY_MS', 150),
  liveMaxDelayMs: whole('JOINERY_LIVE_MAX_DELAY_MS', 1000),
  presenceTimeoutSeconds: whole('JOINERY_PRESENCE_TIMEOUT_SECONDS', 30),
  codeTtlSeconds: whole('JOINERY_CODE_TTL_SECONDS', 600),
  shareTtlSeconds: whole('JOINERY_SHARE_TTL_SECONDS', 604800),
  exportLinkTtlSeconds: whole('JOINERY_EXPORT_LINK_TTL_SECONDS', 300),
  exportRateLimit: whole('JOINERY_EXPORT_RATE_LIMIT', 10),
  limits: {
    textLimitBytes: whole('JOINERY_TEXT_LIMIT_BYTES', DEFAULT_LIMITS.textLimitBytes),
    entityLimit: whole('JOINERY_ENTITY_LIMIT', DEFAULT_LIMITS.entityLimit),
    statementLimit: whole('JOINERY_STATEMENT_LIMIT', DEFAULT_LIMITS.statementLimit),
    nestingLimit: whole('JOINERY_NESTING_LIMIT', DEFAULT_LIMITS.nestingLimit),
  },
  timeZone: text('JOINERY_TIME_ZONE', 'UTC'),
}
