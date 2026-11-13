// The one place the reference-image address check lives.
import dns from 'node:dns/promises';
import net from 'node:net';

export type AddressCheck = { ok: true; address: string; family: 4 | 6 } | { ok: false };

const MAX_REDIRECTS = 3;

/** Parses nonstandard host notations (decimal, octal, hex) into dotted IPv4. */
function normalizeIpv4Host(host: string): string {
  const parts = host.split('.');
  if (parts.length < 1 || parts.length > 4) return host;
  if (!parts.every((p) => /^(0[xX])?[0-9a-fA-F]+$/.test(p))) return host;
  const values = parts.map((p) => {
    if (/^0[xX]/.test(p)) return parseInt(p.slice(2), 16);
    if (/^0[0-7]*$/.test(p) && p.length > 1) return parseInt(p, 8);
    return parseInt(p, 10);
  });
  if (values.some((v) => !Number.isFinite(v) || v < 0)) return host;
  // inet_aton semantics: the last part absorbs the remaining bytes.
  const lead = values.slice(0, -1);
  if (lead.some((v) => v > 255)) return host;
  const last = values[values.length - 1] ?? 0;
  const tailCount = 4 - lead.length;
  if (tailCount < 1 || last > 256 ** tailCount - 1) return host;
  const bytes = [...lead];
  let rest = last;
  const tail: number[] = [];
  for (let i = 0; i < tailCount; i++) {
    tail.unshift(rest % 256);
    rest = Math.floor(rest / 256);
  }
  bytes.push(...tail);
  if (bytes.length !== 4 || bytes.some((b) => b > 255)) return host;
  return bytes.map((b) => String(b)).join('.');
}

function ipv4Refused(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) return true;
  const [a, b] = parts as [number, number, number, number];
  if (a === 127) return true; // loopback
  if (a === 0) return true; // 0.0.0.0/8
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true; // link-local + cloud metadata
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a === 224 || a === 239) return true; // multicast
  if (a === 255) return true; // broadcast
  return false;
}

function ipv6Refused(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === '::' || lower === '::1') return true; // unspecified, loopback
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // fc00::/7 ULA
  if (lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb')) return true; // fe80::/10 link-local
  if (lower.startsWith('ff')) return true; // multicast
  // An embedded dotted quad at the end covers IPv4-mapped and IPv4-compatible forms.
  const embedded = lower.match(/^(?:(.*):)?(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (embedded) {
    const prefix = embedded[1] ?? '';
    const v4 = embedded[2] ?? '';
    // ::ffff:a.b.c.d is IPv4-mapped; ::a.b.c.d is IPv4-compatible.
    if (prefix === '' || prefix === '0' || prefix === 'ffff') return ipv4Refused(v4);
  }
  // The hex form of the same mappings: the last 32 bits are the IPv4 address.
  const groups = parseIpv6(lower);
  if (groups && groups.length === 8) {
    const quad = (g6: number, g7: number): string => {
      const a = g6 >> 8;
      const b = g6 & 0xff;
      const c = g7 >> 8;
      const d = g7 & 0xff;
      return `${a}.${b}.${c}.${d}`;
    };
    // IPv4-mapped: ::ffff:0:0:0/96, so groups[0..4] are 0, groups[5] is 0xffff.
    if (groups.slice(0, 5).every((g) => g === 0) && (groups[5] ?? 0) === 0xffff) {
      return ipv4Refused(quad(groups[6] ?? 0, groups[7] ?? 0));
    }
    // IPv4-compatible: ::0:0:0/96 with a nonzero tail.
    if (groups.slice(0, 6).every((g) => g === 0) && ((groups[6] ?? 0) !== 0 || (groups[7] ?? 0) !== 0)) {
      return ipv4Refused(quad(groups[6] ?? 0, groups[7] ?? 0));
    }
  }
  return false;
}

/** Parses an IPv6 address into its eight 16-bit groups, or null. */
function parseIpv6(ip: string): number[] | null {
  const halves = ip.split('::');
  if (halves.length > 2) return null;
  const parseSide = (side: string): number[] => {
    if (side === '') return [];
    const parts = side.split(':');
    const groups: number[] = [];
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (part === undefined) continue;
      // An embedded dotted quad ends the address as two groups.
      if (part.includes('.')) {
        const v4 = parts.slice(i).join(':');
        const bytes = v4.split('.').map(Number);
        if (bytes.length !== 4 || bytes.some((b) => !Number.isInteger(b) || b < 0 || b > 255)) return groups;
        groups.push(((bytes[0] ?? 0) << 8) | (bytes[1] ?? 0));
        groups.push(((bytes[2] ?? 0) << 8) | (bytes[3] ?? 0));
        return groups;
      }
      const value = Number.parseInt(part, 16);
      if (!Number.isFinite(value) || value < 0 || value > 0xffff) return groups;
      groups.push(value);
    }
    return groups;
  };
  if (halves.length === 2) {
    const head = parseSide(halves[0] ?? '');
    const tail = parseSide(halves[1] ?? '');
    const missing = 8 - head.length - tail.length;
    if (missing < 0) return null;
    return [...head, ...new Array<number>(missing).fill(0), ...tail];
  }
  const groups = parseSide(ip);
  if (groups.length !== 8) return null;
  return groups;
}

export function ipRefused(ip: string): boolean {
  if (net.isIPv4(ip)) return ipv4Refused(ip);
  if (net.isIPv6(ip)) return ipv6Refused(ip);
  return true;
}

/** Every address the host resolves to must be public. */
export async function checkHost(host: string): Promise<AddressCheck> {
  let lookupHost = host;
  if (!host.includes(':')) {
    const norm = normalizeIpv4Host(host);
    if (norm !== host && net.isIPv4(norm)) return ipRefused(norm) ? { ok: false } : { ok: true, address: norm, family: 4 };
    lookupHost = norm;
  } else if (net.isIPv6(host)) {
    return ipRefused(host) ? { ok: false } : { ok: true, address: host, family: 6 };
  }
  try {
    const results = await dns.lookup(lookupHost, { all: true, verbatim: true });
    if (results.length === 0) return { ok: false };
    for (const r of results) {
      if (ipRefused(r.address)) return { ok: false };
    }
    const first = results[0];
    if (!first) return { ok: false };
    return { ok: true, address: first.address, family: first.family === 6 ? 6 : 4 };
  } catch {
    return { ok: false };
  }
}

export interface SafeFetchResult {
  ok: boolean;
  refused?: boolean;
  status?: number;
  contentType?: string;
  bytes?: Buffer;
}

const ALLOWED_IMAGE_MAX = 12_582_912;

/** Fetch an http(s) image, re-checking every hop of up to 3 redirects. */
export async function fetchImageSafely(url: string, timeoutMs = 10_000): Promise<SafeFetchResult> {
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return { ok: false, refused: true };
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return { ok: false, refused: true };
    const host = parsed.hostname.replace(/^\[|\]$/g, '');
    const check = await checkHost(host);
    if (!check.ok) return { ok: false, refused: true };
    if (check.family === 6) parsed.hostname = `[${check.address}]`;
    else parsed.hostname = check.address;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(parsed, { redirect: 'manual', signal: controller.signal, headers: { 'user-agent': 'SpindriftRooms/1.0' } });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        response.body?.cancel().catch(() => {});
        if (!location) return { ok: false, refused: false };
        if (hop === MAX_REDIRECTS) return { ok: false, refused: false };
        const next = new URL(location, parsed).toString();
        return fetchImageSafelyHop(next, hop + 1, timeoutMs);
      }
      if (!response.ok) return { ok: false, refused: false, status: response.status };
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.length > ALLOWED_IMAGE_MAX) return { ok: false, refused: false };
      const ct = response.headers.get('content-type') ?? 'application/octet-stream';
      return { ok: true, status: response.status, contentType: ct, bytes: buffer };
    } catch {
      return { ok: false, refused: false };
    } finally {
      clearTimeout(timer);
    }
  }
  return { ok: false, refused: true };
}

async function fetchImageSafelyHop(url: string, hop: number, timeoutMs: number): Promise<SafeFetchResult> {
  for (let h = hop; h <= MAX_REDIRECTS; h++) {
    const r = await fetchOnce(url, timeoutMs);
    if (!r.ok && r.refused) return r;
    if (r.redirect !== undefined) {
      if (h === MAX_REDIRECTS) return { ok: false, refused: false };
      url = r.redirect;
      continue;
    }
    return r;
  }
  return { ok: false, refused: false };
}

interface OnceResult extends SafeFetchResult {
  redirect?: string;
}

async function fetchOnce(url: string, timeoutMs: number): Promise<OnceResult> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, refused: true };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return { ok: false, refused: true };
  const host = parsed.hostname.replace(/^\[|\]$/g, '');
  const check = await checkHost(host);
  if (!check.ok) return { ok: false, refused: true };
  if (check.family === 6) parsed.hostname = `[${check.address}]`;
  else parsed.hostname = check.address;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(parsed, { redirect: 'manual', signal: controller.signal, headers: { 'user-agent': 'SpindriftRooms/1.0' } });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      response.body?.cancel().catch(() => {});
      return location ? { ok: false, refused: false, redirect: new URL(location, parsed).toString() } : { ok: false, refused: false };
    }
    if (!response.ok) return { ok: false, refused: false, status: response.status };
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > ALLOWED_IMAGE_MAX) return { ok: false, refused: false };
    const ct = response.headers.get('content-type') ?? 'application/octet-stream';
    return { ok: true, status: response.status, contentType: ct, bytes: buffer };
  } catch {
    return { ok: false, refused: false };
  } finally {
    clearTimeout(timer);
  }
}

/** Entry point used by the renders API. */
export async function fetchReferenceImage(url: string): Promise<SafeFetchResult> {
  try {
    const first = await fetchOnce(url, 10_000);
    if (!first.ok && first.refused) return { ok: false, refused: true };
    if (first.redirect !== undefined) return fetchImageSafelyHop(first.redirect, 1, 10_000);
    return first;
  } catch {
    return { ok: false, refused: false };
  }
}
