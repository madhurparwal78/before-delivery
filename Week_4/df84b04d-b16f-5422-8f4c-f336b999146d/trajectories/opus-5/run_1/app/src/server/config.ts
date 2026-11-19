/** Every service address, timer, limit and key, read from the environment at start. */

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`${name} is not set`);
  }
  return value;
}

function text(name: string, fallback: string): string {
  const value = process.env[name];
  return value === undefined || value === '' ? fallback : value;
}

function number(name: string, fallback: number): number {
  const value = process.env[name];
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`${name} is not a number`);
  return parsed;
}

export const config = {
  port: number('APP_PUBLIC_PORT', 4173),
  publicUrl: text('APP_PUBLIC_URL', 'http://127.0.0.1:4173').replace(/\/+$/, ''),
  databaseUrl: required('DATABASE_URL'),
  valkeyUrl: text('VALKEY_URL', ''),
  smtpHost: text('SMTP_HOST', ''),
  smtpPort: number('SMTP_PORT', 1025),
  mailFrom: text('MAIL_FROM', 'Twigline <hello@twigline.test>'),
  gradingKey: process.env['GRADING_KEY'] ?? '',
  outlineToday: text('OUTLINE_TODAY', ''),
  timeZone: text('OUTLINE_TIME_ZONE', 'Europe/London'),
  confirmCodeSeconds: number('TWIG_CONFIRM_CODE_SECONDS', 900),
  inviteTtlSeconds: number('TWIG_INVITE_TTL_SECONDS', 259_200),
  trashSeconds: number('TWIG_TRASH_SECONDS', 2_592_000),
  undoDepth: number('TWIG_UNDO_DEPTH', 100),
  streamMaxLen: number('TWIG_STREAM_MAXLEN', 10_000),
  heartbeatSeconds: number('TWIG_HEARTBEAT_SECONDS', 15),
  pauseAfterSeconds: number('TWIG_PAUSE_AFTER_SECONDS', 5),
  bulletMaxChars: number('TWIG_BULLET_MAX_CHARS', 4_000),
  maxDepth: number('TWIG_MAX_DEPTH', 40),
  searchMaxChars: number('TWIG_SEARCH_MAX_CHARS', 200),
  bodyLimit: 65_536,
  gradingBodyLimit: 1_048_576
} as const;

/** Today, from OUTLINE_TODAY or the configured time zone. */
export function today(): string {
  if (config.outlineToday !== '') return config.outlineToday;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: config.timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date());
}
