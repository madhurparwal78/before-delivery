// Rounding, formatting and encoding shared by the server and the client.

export function roundHalfUp2(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const negative = value < 0;
  const abs = Math.abs(value);
  const scaled = abs * 100;
  const rounded = Math.ceil(scaled - 0.5);
  const out = rounded / 100;
  return negative ? -out : out;
}

export function fmt2(value: number | null): string {
  if (value === null || value === undefined) return '-';
  return roundHalfUp2(value).toFixed(2);
}

export function fmtPercent(value: number | null): string {
  if (value === null || value === undefined) return '-';
  return `${roundHalfUp2(value).toFixed(2)}%`;
}

export function fmtSeconds(ms: number | null): string {
  if (ms === null || ms === undefined) return '-';
  return `${roundHalfUp2(ms / 1000).toFixed(2)} s`;
}

/** Whole numbers rounded half up. */
export function roundHalfUpInt(value: number): number {
  return Math.ceil(value - 0.5);
}

export function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** `YYYY-MM-DD` in UTC. */
export function utcDate(d: Date): string {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

/** `YYYY-MM-DD HH:MM` in UTC. */
export function utcDateTime(d: Date): string {
  return `${utcDate(d)} ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
}

/** `YYYY-MM-DD HH:MM UTC`. */
export function utcDateTimeFull(d: Date): string {
  return `${utcDateTime(d)} UTC`;
}

/** English ordinal: 1st, 2nd, 3rd, 4th, ... 11th, 12th, 13th, 21st. */
export function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  const mod10 = n % 10;
  if (mod10 === 1) return `${n}st`;
  if (mod10 === 2) return `${n}nd`;
  if (mod10 === 3) return `${n}rd`;
  return `${n}th`;
}

export function sha256Hex(bytes: Uint8Array): Promise<string> {
  const cryptoObj = globalThis.crypto;
  return cryptoObj.subtle.digest('SHA-256', bytes as unknown as ArrayBuffer).then((buf) => {
    return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
  });
}

/** Code points, so an emoji counts as one character. */
export function countCodePoints(text: string): number {
  let n = 0;
  for (const _ of text) n++;
  return n;
}

/** Runs of whitespace collapse to one space, trimmed. */
export function normalizeCustomText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

export function countWords(text: string): number {
  const trimmed = text.trim();
  if (trimmed === '') return 0;
  return trimmed.split(/\s+/).length;
}
