import { randomBytes, createHash, scryptSync, timingSafeEqual } from 'node:crypto';

export interface Config {
  paletteMax: number;
  spriteMax: number;
  frameMinMs: number;
  frameMaxMs: number;
  inviteTtlSeconds: number;
  longPressMs: number;
  presenceVisible: number;
  idleSeconds: number;
  undoDepth: number;
  activityPage: number;
  autosaveMs: number;
  jobItemMs: number;
  importMaxBytes: number;
  gradingKey: string | null;
  startAt: string | null;
  publicUrl: string | null;
  port: number;
  mailFrom: string;
  smtpHost: string;
  smtpPort: number;
}

export function readConfig(): Config {
  const env = (k: string, d?: string): string | undefined => process.env[k] ?? d;
  return {
    paletteMax: int(env('CELMATE_PALETTE_MAX'), 255),
    spriteMax: int(env('CELMATE_SPRITE_MAX'), 512),
    frameMinMs: int(env('CELMATE_FRAME_MIN_MS'), 10),
    frameMaxMs: int(env('CELMATE_FRAME_MAX_MS'), 65535),
    inviteTtlSeconds: int(env('CELMATE_INVITE_TTL_SECONDS'), 604800),
    longPressMs: int(env('CELMATE_LONG_PRESS_MS'), 500),
    presenceVisible: int(env('CELMATE_PRESENCE_VISIBLE'), 4),
    idleSeconds: int(env('CELMATE_IDLE_SECONDS'), 300),
    undoDepth: int(env('CELMATE_UNDO_DEPTH'), 50),
    activityPage: int(env('CELMATE_ACTIVITY_PAGE'), 50),
    autosaveMs: int(env('CELMATE_AUTOSAVE_MS'), 1000),
    jobItemMs: int(env('CELMATE_JOB_ITEM_MS'), 0),
    importMaxBytes: int(env('CELMATE_IMPORT_MAX_BYTES'), 5000000),
    gradingKey: env('GRADING_KEY') ?? null,
    startAt: env('CELMATE_START_AT') ?? null,
    publicUrl: env('APP_PUBLIC_URL') ?? null,
    port: int(env('APP_PUBLIC_PORT') ?? env('PORT'), 4173),
    mailFrom: env('MAIL_FROM', 'Celmate <no-reply@celmate.example>')!,
    smtpHost: env('SMTP_HOST', 'mailpit')!,
    smtpPort: int(env('SMTP_PORT'), 1025)
  };
}

function int(v: string | undefined, d: number): number {
  if (v === undefined || v === '') return d;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : d;
}

export function hashPassword(pw: string): string {
  const salt = randomBytes(16).toString('hex');
  const key = scryptSync(pw, salt, 32).toString('hex');
  return `sc:${salt}:${key}`;
}

export function checkPassword(pw: string, stored: string): boolean {
  const [tag, salt, key] = stored.split(':');
  if (tag !== 'sc') return false;
  const test = scryptSync(pw, salt, 32);
  return timingSafeEqual(test, Buffer.from(key, 'hex'));
}

export function randomToken(): string {
  return randomBytes(16).toString('hex');
}

export function sixDigitCode(): string {
  return String(Math.floor(Math.random() * 1000000)).padStart(6, '0');
}

export function sha256Hex(data: Buffer | Uint8Array | string): string {
  return createHash('sha256').update(data).digest('hex');
}

export function slugify(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return slug || 'sprite';
}

export function safeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_');
}
