import { createHash } from 'node:crypto';
import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';

/**
 * Reference-image fetching. The address check below is the only place the
 * product decides whether an outbound address may be contacted.
 */

export const REFERENCE_IMAGE_MAX_BYTES = 12_582_912;
const REFERENCE_IMAGE_TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 3;

export class AddressRefused extends Error {}
export class FetchFailed extends Error {}

function parseByte(token: string): number | null {
  if (token.length === 0) return null;
  let value: number;
  if (/^0[xX][0-9a-fA-F]+$/.test(token)) value = Number.parseInt(token.slice(2), 16);
  else if (/^0[0-7]+$/.test(token)) value = Number.parseInt(token.slice(1), 8);
  else if (/^[0-9]+$/.test(token)) value = Number.parseInt(token, 10);
  else return null;
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

/**
 * Read a host written as decimal, octal or hex numbers as the IPv4 address it
 * denotes, following the classic inet_aton forms (a, a.b, a.b.c, a.b.c.d).
 */
export function parseNumericIpv4(host: string): string | null {
  const trimmed = host.endsWith('.') ? host.slice(0, -1) : host;
  const parts = trimmed.split('.');
  if (parts.length === 0 || parts.length > 4) return null;
  const values: number[] = [];
  for (const part of parts) {
    const v = parseByte(part);
    if (v === null) return null;
    values.push(v);
  }
  const last = values[values.length - 1]!;
  const leading = values.slice(0, -1);
  if (leading.some((v) => v > 255)) return null;
  const maxLast = 256 ** (4 - leading.length);
  if (last >= maxLast) return null;
  let total = last;
  for (let i = 0; i < leading.length; i += 1) {
    total += leading[i]! * 256 ** (3 - i);
  }
  return [total >>> 24, (total >>> 16) & 255, (total >>> 8) & 255, total & 255].join('.');
}

function ipv4Refused(ip: string): boolean {
  const o = ip.split('.').map(Number);
  const a = o[0] ?? 0;
  const b = o[1] ?? 0;
  if (a === 127) return true; // loopback
  if (a === 0) return true; // 0.0.0.0/8
  if (a === 10) return true; // private
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12
  if (a === 192 && b === 168) return true; // 192.168/16
  if (a === 169 && b === 254) return true; // link-local, cloud metadata included
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64/10
  if (a >= 224) return true; // multicast and broadcast
  return false;
}

function expandIpv6(ip: string): number[] | null {
  const zoneless = ip.split('%')[0] ?? ip;
  const hasEmbeddedV4 = zoneless.includes('.');
  let head = zoneless;
  let tailBytes: number[] = [];
  if (hasEmbeddedV4) {
    const idx = zoneless.lastIndexOf(':');
    const v4 = zoneless.slice(idx + 1);
    if (!net.isIPv4(v4)) return null;
    tailBytes = v4.split('.').map(Number);
    head = `${zoneless.slice(0, idx + 1)}0:0`;
  }
  const doubleIdx = head.indexOf('::');
  let groups: string[];
  if (doubleIdx >= 0) {
    const left = head.slice(0, doubleIdx).split(':').filter((s) => s !== '');
    const right = head.slice(doubleIdx + 2).split(':').filter((s) => s !== '');
    const fill = 8 - left.length - right.length;
    if (fill < 0) return null;
    groups = [...left, ...Array.from({ length: fill }, () => '0'), ...right];
  } else {
    groups = head.split(':');
  }
  if (groups.length !== 8) return null;
  const bytes: number[] = [];
  for (const g of groups) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null;
    const v = Number.parseInt(g, 16);
    bytes.push((v >> 8) & 255, v & 255);
  }
  if (hasEmbeddedV4) bytes.splice(12, 4, ...tailBytes);
  return bytes;
}

function ipv6Refused(ip: string): boolean {
  const bytes = expandIpv6(ip);
  if (!bytes) return true;
  if (bytes.slice(0, 15).every((x) => x === 0) && bytes[15] === 1) return true; // ::1
  if (bytes.every((x) => x === 0)) return true; // ::
  const first = bytes[0] ?? 0;
  if ((first & 0xfe) === 0xfc) return true; // fc00::/7
  if (first === 0xfe && ((bytes[1] ?? 0) & 0xc0) === 0x80) return true; // fe80::/10
  if (first === 0xff) return true; // multicast
  const isMapped = bytes.slice(0, 10).every((x) => x === 0) && bytes[10] === 0xff && bytes[11] === 0xff;
  const isCompatible = bytes.slice(0, 12).every((x) => x === 0);
  if (isMapped || isCompatible) return ipv4Refused(bytes.slice(12, 16).join('.'));
  return false;
}

/** True when the literal address must never be contacted. */
export function isRefusedAddress(ip: string): boolean {
  if (net.isIPv4(ip)) return ipv4Refused(ip);
  if (net.isIPv6(ip)) return ipv6Refused(ip);
  return true;
}

interface SafeTarget {
  url: URL;
  addresses: { address: string; family: number }[];
}

/**
 * Check one hop: the scheme must be http or https and every address the host
 * resolves to must be public.
 */
async function checkHop(raw: string): Promise<SafeTarget> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new AddressRefused('not a url');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new AddressRefused('scheme');
  const host = url.hostname.replace(/^\[|\]$/g, '');

  if (net.isIP(host)) {
    if (isRefusedAddress(host)) throw new AddressRefused('literal');
    return { url, addresses: [{ address: host, family: net.isIPv6(host) ? 6 : 4 }] };
  }

  const numeric = parseNumericIpv4(host);
  if (numeric) {
    if (isRefusedAddress(numeric)) throw new AddressRefused('numeric');
    return { url, addresses: [{ address: numeric, family: 4 }] };
  }

  let resolved: dns.LookupAddress[];
  try {
    resolved = await dns.promises.lookup(host, { all: true, verbatim: true });
  } catch {
    throw new FetchFailed('dns');
  }
  if (resolved.length === 0) throw new FetchFailed('dns empty');
  for (const entry of resolved) {
    if (isRefusedAddress(entry.address)) throw new AddressRefused('resolved');
  }
  return { url, addresses: resolved.map((r) => ({ address: r.address, family: r.family })) };
}

function sniffImageType(bytes: Buffer): 'image/png' | 'image/jpeg' | null {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  ) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  return null;
}

interface HopResult {
  redirectTo?: string;
  body?: Buffer;
}

function requestHop(target: SafeTarget, deadline: number): Promise<HopResult> {
  return new Promise<HopResult>((resolve, reject) => {
    const isHttps = target.url.protocol === 'https:';
    const transport = isHttps ? https : http;
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      reject(new FetchFailed('timeout'));
      return;
    }
    const hostname = target.url.hostname.replace(/^\[|\]$/g, '');
    const req = transport.request(
      {
        protocol: target.url.protocol,
        hostname,
        port: target.url.port || (isHttps ? 443 : 80),
        path: `${target.url.pathname}${target.url.search}`,
        method: 'GET',
        headers: { accept: 'image/png,image/jpeg', 'user-agent': 'Spindrift-Rooms' },
        // The connection goes to the address that was checked, not a fresh lookup.
        lookup: ((
          _hostname: string,
          options: dns.LookupOneOptions & { all?: boolean },
          callback: (err: Error | null, address: string | dns.LookupAddress[], family?: number) => void,
        ) => {
          const chosen =
            target.addresses.find((a) => !options.family || options.family === a.family) ??
            target.addresses[0];
          if (!chosen) {
            callback(new Error('no address'), '', 4);
            return;
          }
          if (options.all) callback(null, [{ address: chosen.address, family: chosen.family }]);
          else callback(null, chosen.address, chosen.family);
        }) as unknown as undefined,
      },
      (res) => {
        const status = res.statusCode ?? 0;
        const location = res.headers.location;
        if (status >= 300 && status < 400 && location) {
          res.resume();
          try {
            resolve({ redirectTo: new URL(location, target.url).toString() });
          } catch {
            reject(new FetchFailed('bad redirect'));
          }
          return;
        }
        if (status !== 200) {
          res.resume();
          reject(new FetchFailed(`status ${status}`));
          return;
        }
        const chunks: Buffer[] = [];
        let total = 0;
        res.on('data', (chunk: Buffer) => {
          total += chunk.length;
          if (total > REFERENCE_IMAGE_MAX_BYTES) {
            req.destroy();
            reject(new FetchFailed('too large'));
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () => resolve({ body: Buffer.concat(chunks) }));
        res.on('error', () => reject(new FetchFailed('stream')));
      },
    );
    req.setTimeout(Math.max(1, remaining), () => {
      req.destroy();
      reject(new FetchFailed('timeout'));
    });
    req.on('error', () => reject(new FetchFailed('connection')));
    req.end();
  });
}

export interface ReferenceImage {
  sourceUrl: string;
  contentType: 'image/png' | 'image/jpeg';
  sha256: string;
  bytes: Buffer;
}

/**
 * Fetch a reference image. Every hop is checked before it is contacted and at
 * most three redirects are followed.
 */
export async function fetchReferenceImage(rawUrl: string): Promise<ReferenceImage> {
  const deadline = Date.now() + REFERENCE_IMAGE_TIMEOUT_MS;
  let current = rawUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const target = await checkHop(current);
    const result = await requestHop(target, deadline);
    if (result.redirectTo !== undefined) {
      current = result.redirectTo;
      continue;
    }
    const body = result.body ?? Buffer.alloc(0);
    const contentType = sniffImageType(body);
    if (!contentType) throw new FetchFailed('not an image');
    return {
      sourceUrl: target.url.toString(),
      contentType,
      sha256: createHash('sha256').update(body).digest('hex'),
      bytes: body,
    };
  }
  throw new FetchFailed('too many redirects');
}
