import { createHash, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';

export const ZONE = 'America/Argentina/Buenos_Aires';
export const BA_OFFSET_MINUTES = -180;
export const BA_OFFSET_SUFFIX = '-03:00';

export function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export const config = {
  port: Number(process.env.APP_PUBLIC_PORT ?? 4173),
  databaseUrl: process.env.DATABASE_URL ?? '',
  s3: {
    endpoint: process.env.S3_ENDPOINT ?? '',
    region: process.env.S3_REGION ?? 'us-east-1',
    bucket: process.env.S3_BUCKET ?? '',
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== 'false',
    accessKeyId: process.env.S3_ACCESS_KEY_ID ?? '',
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? '',
  },
  pocketbase: {
    url: process.env.POCKETBASE_URL ?? '',
    adminEmail: process.env.POCKETBASE_ADMIN_EMAIL ?? '',
    adminPassword: process.env.POCKETBASE_ADMIN_PASSWORD ?? '',
  },
  killbill: {
    url: process.env.KILLBILL_URL ?? '',
    username: process.env.KILLBILL_USERNAME ?? '',
    password: process.env.KILLBILL_PASSWORD ?? '',
    apiKey: process.env.KILLBILL_API_KEY ?? '',
    apiSecret: process.env.KILLBILL_API_SECRET ?? '',
  },
  mail: {
    host: process.env.SMTP_HOST ?? '',
    port: envNumber('SMTP_PORT', 1025),
    from: process.env.MAIL_FROM ?? 'Pampero Build Co. <ledger@pampero.test>',
  },
  publicUrl: process.env.APP_PUBLIC_URL ?? `http://127.0.0.1:${process.env.APP_PUBLIC_PORT ?? 4173}`,
  dunningDaySeconds: envNumber('DUNNING_DAY_SECONDS', 86400),
  downloadLinkSeconds: envNumber('DOWNLOAD_LINK_SECONDS', 60),
  previewTtlSeconds: envNumber('PREVIEW_TTL_SECONDS', 600),
  inviteTtlSeconds: envNumber('INVITE_TTL_SECONDS', 604800),
};

const BA_DATE = new Intl.DateTimeFormat('en-CA', {
  timeZone: ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

export interface BaParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

/** Buenos Aires wall-clock parts of an instant. */
export function baParts(date: Date): BaParts {
  const parts = BA_DATE.formatToParts(date);
  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? '0');
  const hour = get('hour');
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: hour === 24 ? 0 : hour,
    minute: get('minute'),
    second: get('second'),
  };
}

/** The Buenos Aires business date (YYYY-MM-DD) of an instant. */
export function baDate(date: Date): string {
  const p = baParts(date);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/** ISO 8601 instant with the studio offset, e.g. 2026-11-01T14:05:09-03:00. */
export function studioInstant(date: Date): string {
  const shifted = new Date(date.getTime() + BA_OFFSET_MINUTES * 60_000);
  const text = shifted.toISOString();
  return `${text.slice(0, 19)}${BA_OFFSET_SUFFIX}`;
}

export function newId(): string {
  return randomUUID();
}

export function hashPassword(password: string): string {
  const salt = randomUUID().replace(/-/g, '');
  const hash = scryptSync(password, salt, 32).toString('hex');
  return `scrypt:${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, salt, hash] = stored.split(':');
  if (scheme !== 'scrypt' || salt === undefined || hash === undefined) return false;
  const candidate = scryptSync(password, salt, 32);
  const expected = Buffer.from(hash, 'hex');
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

export function sha256Hex(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

export function readFileBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let done = false;
    req.on('data', (chunk: Buffer) => {
      if (done) return;
      total += chunk.length;
      if (total > limit) {
        done = true;
        reject(new Error('body_too_large'));
        req.resume();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!done) {
        done = true;
        resolve(Buffer.concat(chunks));
      }
    });
    req.on('error', (err) => {
      if (!done) {
        done = true;
        reject(err);
      }
    });
  });
}

export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields: Record<string, string> | undefined;
  readonly extra: Record<string, unknown> | undefined;

  constructor(status: number, code: string, message: string, fields?: Record<string, string>, extra?: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = fields;
    this.extra = extra;
  }
}

export function sendJson(res: ServerResponse, status: number, body: unknown, extraHeaders?: Record<string, string>): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload).toString(),
    ...extraHeaders,
  });
  res.end(payload);
}

export function sendError(res: ServerResponse, err: HttpError): void {
  const body: Record<string, unknown> = { error: err.code, message: err.message };
  if (err.fields) body.fields = err.fields;
  if (err.extra) {
    for (const [key, value] of Object.entries(err.extra)) {
      body[key] = value;
    }
  }
  sendJson(res, err.status, body);
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const name = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (name) out[name] = decodeURIComponent(value);
  }
  return out;
}

export function streamToBuffer(stream: Readable): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on('data', (c) => chunks.push(c as Buffer));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
