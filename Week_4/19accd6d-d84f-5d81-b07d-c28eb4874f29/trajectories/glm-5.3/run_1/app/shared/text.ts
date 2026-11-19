/** Text helpers shared by the worker and the page. */

/** The one place line counting is decided: 0 for empty, otherwise LF bytes plus 1. */
export function countLines(bytes: Uint8Array): number {
  let lines = 0;
  for (let i = 0; i < bytes.length; i++) if (bytes[i] === 0x0a) lines++;
  return bytes.length === 0 ? 0 : lines + 1;
}

export function byteCountText(bytes: number, lines: number): string {
  const b = `${bytes} ${bytes === 1 ? 'byte' : 'bytes'}`;
  const l = `${lines} ${lines === 1 ? 'line' : 'lines'}`;
  return `${b} · ${l}`;
}

/** Unescapes \n, \r, \t and \\ in Split delimiter, Joiner and CSV delimiter arguments. */
export function unescapeArg(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '\\' && i + 1 < text.length) {
      const n = text[i + 1];
      if (n === 'n') { out += '\n'; i++; continue; }
      if (n === 'r') { out += '\r'; i++; continue; }
      if (n === 't') { out += '\t'; i++; continue; }
      if (n === '\\') { out += '\\'; i++; continue; }
    }
    out += c;
  }
  return out;
}

/** Detects the suggested operation over the first 4096 input bytes. */
export function detectSuggestion(bytes: Uint8Array): string | null {
  const head = bytes.length > 4096 ? bytes.subarray(0, 4096) : bytes;
  if (head.length >= 2 && head[0] === 0x1f && head[1] === 0x8b) return 'Gunzip';
  if (hexPairs(head)) return 'From Hex';
  if (isBase64ish(head)) return 'From Base64';
  if ((head[0] === 0x7b || head[0] === 0x5b) && parsesAsJson(head)) return 'JSON Beautify';
  for (let i = 0; i + 2 < head.length; i++) {
    if (head[i] === 0x25 && isHexByte(head[i + 1]) && isHexByte(head[i + 2])) return 'URL Decode';
  }
  return null;

  function isHexByte(c: number): boolean {
    return (c >= 0x30 && c <= 0x39) || (c >= 0x41 && c <= 0x46) || (c >= 0x61 && c <= 0x66);
  }
  function hexPairs(b: Uint8Array): boolean {
    let pairs = 0;
    let pending = false;
    for (let i = 0; i < b.length; i++) {
      const c = b[i];
      if (isHexByte(c)) {
        pending = !pending;
        if (!pending) pairs++;
        continue;
      }
      if (pending) return false;
      if (c === 0x20 || c === 0x2c || c === 0x3a || c === 0x0a) continue;
      return false;
    }
    if (pending) return false;
    return pairs >= 4;
  }
  function isBase64ish(b: Uint8Array): boolean {
    if (b.length < 8 || b.length % 4 !== 0) return false;
    let end = b.length;
    if (b[end - 1] === 0x3d) end--;
    if (b[end - 1] === 0x3d) end--;
    for (let i = 0; i < end; i++) {
      const c = b[i];
      const ok = (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a) || (c >= 0x30 && c <= 0x39) || c === 0x2b || c === 0x2f;
      if (!ok) return false;
    }
    return true;
  }
  function parsesAsJson(b: Uint8Array): boolean {
    try {
      JSON.parse(new TextDecoder('utf-8', { fatal: false }).decode(b));
      return true;
    } catch {
      return false;
    }
  }
}

export const B64URL_UNRESERVED = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

export function toBase64Url(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(text: string): Uint8Array {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  const s = atob(padded);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export function formatUtcDate(iso: string): string {
  const d = new Date(iso.endsWith('Z') || iso.includes('+') ? iso : `${iso}Z`);
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const hh = `${d.getUTCHours()}`.padStart(2, '0');
  const mm = `${d.getUTCMinutes()}`.padStart(2, '0');
  return `${d.getUTCDate()} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()} at ${hh}:${mm} UTC`;
}

export function localDate(iso: string): string {
  const d = new Date(iso.endsWith('Z') || iso.includes('+') ? iso : `${iso}Z`);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** The one place "expires after" labels are built from a ttl spec like `1h`. */
export function ttlLabel(ttl: string): string {
  const m = /^([0-9]+)([smhd])$/.exec(ttl);
  if (!m) return ttl;
  const n = Number(m[1]);
  const unit = n === 1 ? { s: 'second', m: 'minute', h: 'hour', d: 'day' }[m[2]] : { s: 'seconds', m: 'minutes', h: 'hours', d: 'days' }[m[2]];
  return `${n} ${unit}`;
}

export function ttlSeconds(ttl: string): number {
  const m = /^([0-9]+)([smhd])$/.exec(ttl);
  if (!m) return 0;
  const n = Number(m[1]);
  return n * ({ s: 1, m: 60, h: 3600, d: 86400 } as Record<string, number>)[m[2]];
}
