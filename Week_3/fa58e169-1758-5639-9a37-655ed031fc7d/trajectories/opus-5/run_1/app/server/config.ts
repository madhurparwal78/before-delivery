function text(name: string, fallback = ''): string {
  const value = process.env[name];
  return value === undefined || value === '' ? fallback : value;
}

function whole(name: string, fallback: number): number {
  const value = process.env[name];
  if (value === undefined || value.trim() === '') return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export interface Limits {
  maxChartRows: number;
  maxChartCols: number;
  maxColours: number;
  coloursPerRow: number;
  maxFloat: number;
  undoDepth: number;
  noteMaxChars: number;
  editsPerMinute: number;
  sheetLinesPerPage: number;
  noticeSeconds: number;
  rowMotionMs: number;
  presenceTtlSeconds: number;
  inviteTtlHours: number;
  verifyTtlHours: number;
}

export const limits: Limits = {
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
};

export const config = {
  port: whole('APP_PUBLIC_PORT', 4173),
  publicUrl: text('APP_PUBLIC_URL', 'http://127.0.0.1:4173'),
  gradingKey: text('GRADING_KEY'),
  databaseUrl: text('DATABASE_URL'),
  valkeyUrl: text('VALKEY_URL'),
  smtpHost: text('SMTP_HOST', '127.0.0.1'),
  smtpPort: whole('SMTP_PORT', 1025),
  mailFrom: text('MAIL_FROM', 'Twinrow <studio@twinrow.test>'),
  timeZone: text('APP_TIME_ZONE', 'UTC'),
  todayOverride: text('APP_TODAY'),
  limits,
};

export const colourLimits = { coloursPerRow: limits.coloursPerRow, maxFloat: limits.maxFloat };

export function today(): string {
  if (config.todayOverride) return config.todayOverride;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: config.timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}
