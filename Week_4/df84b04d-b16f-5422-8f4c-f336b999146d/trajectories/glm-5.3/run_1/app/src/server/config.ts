export interface Config {
  port: number;
  publicUrl: string;
  databaseUrl: string;
  valkeyUrl: string;
  smtpHost: string;
  smtpPort: number;
  mailFrom: string;
  gradingKey: string | null;
  outlineToday: string | null;
  timeZone: string;
  confirmCodeSeconds: number;
  inviteTtlSeconds: number;
  trashSeconds: number;
  undoDepth: number;
  streamMaxlen: number;
  heartbeatSeconds: number;
  pauseAfterSeconds: number;
  bulletMaxChars: number;
  maxDepth: number;
  searchMaxChars: number;
}

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function str(name: string, fallback: string): string {
  const raw = process.env[name];
  return raw === undefined || raw === '' ? fallback : raw;
}

export function loadConfig(): Config {
  return {
    port: num('APP_PUBLIC_PORT', 4173),
    publicUrl: str('APP_PUBLIC_URL', 'http://127.0.0.1:4173').replace(/\/$/, ''),
    databaseUrl: str('DATABASE_URL', 'postgresql://localhost:5432/twigline'),
    valkeyUrl: str('VALKEY_URL', 'redis://localhost:6379/0'),
    smtpHost: str('SMTP_HOST', 'localhost'),
    smtpPort: num('SMTP_PORT', 1025),
    mailFrom: str('MAIL_FROM', 'Twigline <hello@twigline.test>'),
    gradingKey: process.env.GRADING_KEY ?? null,
    outlineToday: process.env.OUTLINE_TODAY ?? null,
    timeZone: str('OUTLINE_TIME_ZONE', 'Europe/London'),
    confirmCodeSeconds: num('TWIG_CONFIRM_CODE_SECONDS', 900),
    inviteTtlSeconds: num('TWIG_INVITE_TTL_SECONDS', 259200),
    trashSeconds: num('TWIG_TRASH_SECONDS', 2592000),
    undoDepth: num('TWIG_UNDO_DEPTH', 100),
    streamMaxlen: num('TWIG_STREAM_MAXLEN', 10000),
    heartbeatSeconds: num('TWIG_HEARTBEAT_SECONDS', 15),
    pauseAfterSeconds: num('TWIG_PAUSE_AFTER_SECONDS', 5),
    bulletMaxChars: num('TWIG_BULLET_MAX_CHARS', 4000),
    maxDepth: num('TWIG_MAX_DEPTH', 40),
    searchMaxChars: num('TWIG_SEARCH_MAX_CHARS', 200),
  };
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function todayFor(config: Config, now: Date): string {
  if (config.outlineToday && DATE_RE.test(config.outlineToday)) return config.outlineToday;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: config.timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  return parts;
}
