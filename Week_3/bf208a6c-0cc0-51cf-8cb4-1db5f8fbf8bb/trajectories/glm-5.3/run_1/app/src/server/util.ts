export function readEnvInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

const ELLIPSIS = '…';

export function isHex(s: string): boolean {
  return /^[0-9a-f]+$/.test(s);
}

export function randomToken(bytes = 32): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function randomId(prefix: string): string {
  return `${prefix}_${randomToken(12)}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function isoPlusSeconds(seconds: number): string {
  return new Date(Date.now() + seconds * 1000).toISOString();
}

export function countCodePoints(s: string): number {
  let n = 0;
  for (const _ of s) n += 1;
  return n;
}

export function trim(s: string): string {
  return s.replace(/^[\s\uFEFF\xA0]+|[\s\uFEFF\xA0]+$/g, '');
}

export function shortText(s: string, max: number): string {
  return countCodePoints(s) > max ? s.slice(0, max) + ELLIPSIS : s;
}

export function formatBytes(n: number): string {
  return n.toLocaleString('en-US');
}
