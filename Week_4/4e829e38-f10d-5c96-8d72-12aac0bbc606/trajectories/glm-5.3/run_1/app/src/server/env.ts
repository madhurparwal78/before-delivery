import * as fs from 'fs';

export interface Limits {
  ruleMaxDepth: number;
  ruleRunsPerMinute: number;
  formulaMaxChars: number;
  formulaMaxSteps: number;
  digestWindowMin: number;
  holdTimeoutMs: number;
  uploadMaxBytes: number;
  pageSize: number;
  moveMs: number;
  progressMs: number;
  toastMs: number;
}

export interface Env {
  databaseUrl: string;
  s3: { endpoint: string; region: string; bucket: string; forcePathStyle: boolean; accessKeyId: string; secretAccessKey: string; };
  smtp: { host: string; port: number; from: string };
  port: number;
  grading: boolean;
  limits: Limits;
  publicUrl: string;
}

function num(name: string, def: number): number {
  const v = process.env[name];
  if (v === undefined || v === '') return def;
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

function bool(name: string): boolean { return process.env[name] === '1'; }

function str(name: string, def: string): string {
  const v = process.env[name];
  return v === undefined || v === '' ? def : v;
}

let cached: Env | null = null;

export function env(): Env {
  if (cached) return cached;
  cached = {
    databaseUrl: str('DATABASE_URL', ''),
    s3: {
      endpoint: str('S3_ENDPOINT', 'http://127.0.0.1:9000'),
      region: str('S3_REGION', 'us-east-1'),
      bucket: str('S3_BUCKET', 'everyweek'),
      forcePathStyle: str('S3_FORCE_PATH_STYLE', 'true') !== 'false',
      accessKeyId: str('S3_ACCESS_KEY_ID', ''),
      secretAccessKey: str('S3_SECRET_ACCESS_KEY', ''),
    },
    smtp: { host: str('SMTP_HOST', '127.0.0.1'), port: num('SMTP_PORT', 1025), from: str('MAIL_FROM', 'Everyweek <hello@everyweek.example>') },
    port: num('APP_PUBLIC_PORT', 4173),
    grading: bool('EVERYWEEK_GRADING'),
    publicUrl: str('APP_PUBLIC_URL', 'http://127.0.0.1:4173'),
    limits: {
      ruleMaxDepth: num('EVERYWEEK_RULE_MAX_DEPTH', 3),
      ruleRunsPerMinute: num('EVERYWEEK_RULE_RUNS_PER_MINUTE', 60),
      formulaMaxChars: num('EVERYWEEK_FORMULA_MAX_CHARS', 200),
      formulaMaxSteps: num('EVERYWEEK_FORMULA_MAX_STEPS', 500),
      digestWindowMin: num('EVERYWEEK_DIGEST_WINDOW_MIN', 60),
      holdTimeoutMs: num('EVERYWEEK_HOLD_TIMEOUT_MS', 30000),
      uploadMaxBytes: num('EVERYWEEK_UPLOAD_MAX_BYTES', 1048576),
      pageSize: num('EVERYWEEK_PAGE_SIZE', 50),
      moveMs: num('EVERYWEEK_MOVE_MS', 320),
      progressMs: num('EVERYWEEK_PROGRESS_MS', 400),
      toastMs: num('EVERYWEEK_TOAST_MS', 4000),
    },
  };
  return cached;
}

export function uploadCapLabel(): string {
  const cap = env().limits.uploadMaxBytes;
  if (cap > 0 && cap % 1048576 === 0) return `${cap / 1048576} MB`;
  return `${cap} bytes`;
}

export interface MailSecret { password?: string; user?: string; }
export function loadSecrets(): void {
  try {
    if (fs.existsSync('/run/secrets.json')) {
      const s = JSON.parse(fs.readFileSync('/run/secrets.json', 'utf8')) as Record<string, string>;
      for (const k of Object.keys(s)) if (!process.env[k]) process.env[k] = s[k];
    }
  } catch { /* optional */ }
}
