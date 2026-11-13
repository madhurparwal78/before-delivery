import type { Limits } from '../shared/api.ts'

function required(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is not set`)
  return value
}

function whole(name: string, fallback: number): number {
  const raw = process.env[name]
  if (raw === undefined || raw === '') return fallback
  const value = Number(raw)
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive whole number`)
  return value
}

export const config = {
  port: whole('APP_PUBLIC_PORT', 4173),
  publicUrl: (process.env.APP_PUBLIC_URL ?? `http://127.0.0.1:${whole('APP_PUBLIC_PORT', 4173)}`).replace(/\/$/, ''),
  databaseUrl: required('DATABASE_URL'),
  valkeyUrl: required('VALKEY_URL'),
  smtpHost: required('SMTP_HOST'),
  smtpPort: whole('SMTP_PORT', 1025),
  mailFrom: required('MAIL_FROM'),
  gradingKey: process.env.GRADING_KEY ?? '',
  appToday: process.env.APP_TODAY ?? '',
  timeZone: process.env.APP_TIME_ZONE || 'UTC',
  limits: {
    maxChartRows: whole('MAX_CHART_ROWS', 120),
    maxChartCols: whole('MAX_CHART_COLS', 80),
    maxColours: whole('MAX_COLOURS', 6),
    coloursPerRow: whole('COLOURS_PER_ROW', 2),
    maxFloat: whole('MAX_FLOAT', 5),
    undoDepth: whole('UNDO_DEPTH', 100),
    noteMaxChars: whole('NOTE_MAX_CHARS', 500),
    editsPerMinute: whole('EDITS_PER_MINUTE', 600),
    sheetLinesPerPage: whole('SHEET_LINES_PER_PAGE', 40),
    noticeSeconds: whole('NOTICE_SECONDS', 6),
    rowMotionMs: whole('ROW_MOTION_MS', 200),
    presenceTtlSeconds: whole('PRESENCE_TTL_SECONDS', 30),
    inviteTtlHours: whole('INVITE_TTL_HOURS', 168),
    verifyTtlHours: whole('VERIFY_TTL_HOURS', 24),
  } satisfies Limits,
}

export function today(): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(config.appToday)) return config.appToday
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: config.timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date())
  const pick = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  return `${pick('year')}-${pick('month')}-${pick('day')}`
}
