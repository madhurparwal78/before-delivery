import { lookup as dnsLookup } from 'node:dns/promises';
import * as http from 'node:http';
import * as https from 'node:https';
import { isIPv4, isIPv6 } from 'node:net';
import { config } from '../config';
import { UPLOAD_LIMIT } from '../config';

const DOTTED_QUAD = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

function ipv4Bytes(hostname: string): number[] | null {
  const match = DOTTED_QUAD.exec(hostname);
  if (!match) return null;
  const parts = match.slice(1).map((part) => {
    if (part.length > 1 && part.startsWith('0')) return -1;
    const value = Number.parseInt(part, 10);
    return value > 255 ? -1 : value;
  });
  return parts.some((part) => part < 0) ? null : parts;
}

function ipv6Bytes(hostname: string): number[] | null {
  if (!isIPv6(hostname)) return null;
  const [head, tail] = hostname.split('::') as [string, string | undefined];
  const expand = (section: string): number[] => {
    if (section.length === 0) return [];
    const bytes: number[] = [];
    for (const group of section.split(':')) {
      const quad = ipv4Bytes(group);
      if (quad) {
        bytes.push(...quad);
        continue;
      }
      const value = Number.parseInt(group, 16);
      bytes.push((value >> 8) & 0xff, value & 0xff);
    }
    return bytes;
  };
  const headBytes = expand(head);
  const tailBytes = tail === undefined ? [] : expand(tail);
  if (tail === undefined) return headBytes.length === 16 ? headBytes : null;
  const fill = 16 - headBytes.length - tailBytes.length;
  if (fill < 0) return null;
  return [...headBytes, ...new Array<number>(fill).fill(0), ...tailBytes];
}

function isRefusedIpv4(bytes: readonly number[]): boolean {
  const [a, b] = [bytes[0]!, bytes[1]!];
  if (a === 0) return true;
  if (a === 127) return true;
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a >= 224) return true;
  if (bytes.every((byte) => byte === 255)) return true;
  return false;
}

function isRefusedIpv6(bytes: readonly number[]): boolean {
  const isMapped =
    bytes.slice(0, 10).every((byte) => byte === 0) && bytes[10] === 0xff && bytes[11] === 0xff;
  if (isMapped) return isRefusedIpv4(bytes.slice(12));
  if (bytes.every((byte, index) => (index === 15 ? byte === 1 : byte === 0))) return true;
  if (bytes.every((byte) => byte === 0)) return true;
  if ((bytes[0]! & 0xfe) === 0xfc) return true;
  if (bytes[0] === 0xfe && (bytes[1]! & 0xc0) === 0x80) return true;
  if (bytes[0] === 0xff) return true;
  return false;
}

export function isRefusedAddress(address: string): boolean {
  const v4 = ipv4Bytes(address);
  if (v4) return isRefusedIpv4(v4);
  const v6 = ipv6Bytes(address);
  if (v6) return isRefusedIpv6(v6);
  return true;
}

export type UrlCheck =
  | { kind: 'ok'; url: URL; address: string; family: 4 | 6 }
  | { kind: 'refused' };

function isExemptHost(hostname: string): boolean {
  return config.outboundAllowedHosts.includes(hostname.toLowerCase());
}

/** Checks scheme and every resolved address, and returns the address a connection must use. */
export async function checkUrl(raw: string): Promise<UrlCheck> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { kind: 'refused' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return { kind: 'refused' };
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  if (hostname.length === 0) return { kind: 'refused' };
  if (hostname.toLowerCase() === 'localhost') return { kind: 'refused' };

  const literalV4 = isIPv4(hostname) ? hostname : null;
  const literalV6 = isIPv6(hostname) ? hostname : null;
  if (literalV4 || literalV6) {
    if (isRefusedAddress(hostname)) return { kind: 'refused' };
    return { kind: 'ok', url, address: hostname, family: literalV4 ? 4 : 6 };
  }
  if (/^[0-9.]+$/.test(hostname) || /^0[xX][0-9a-fA-F]+$/.test(hostname) || /^[0-9]+$/.test(hostname)) {
    return { kind: 'refused' };
  }

  let addresses: { address: string; family: number }[];
  try {
    addresses = await dnsLookup(hostname, { all: true });
  } catch {
    return { kind: 'refused' };
  }
  if (addresses.length === 0) return { kind: 'refused' };
  if (!isExemptHost(hostname) && addresses.some((entry) => isRefusedAddress(entry.address))) {
    return { kind: 'refused' };
  }
  const first = addresses[0]!;
  return { kind: 'ok', url, address: first.address, family: first.family === 6 ? 6 : 4 };
}

export interface OutboundResponse {
  statusCode: number;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
}

interface OutboundOptions {
  method: 'GET' | 'POST';
  timeoutMs: number;
  headers?: Record<string, string>;
  payload?: Buffer;
  maxBytes?: number;
}

/** One request to an already-checked address, with the original host header. */
function requestChecked(check: Extract<UrlCheck, { kind: 'ok' }>, options: OutboundOptions): Promise<OutboundResponse> {
  const { url, address } = check;
  const isHttps = url.protocol === 'https:';
  const transport = isHttps ? https : http;
  const port = url.port !== '' ? Number.parseInt(url.port, 10) : isHttps ? 443 : 80;
  const maxBytes = options.maxBytes ?? UPLOAD_LIMIT;
  return new Promise<OutboundResponse>((resolve, reject) => {
    const request = transport.request(
      {
        host: address,
        port,
        method: options.method,
        path: `${url.pathname}${url.search}`,
        headers: { host: url.host, ...(options.headers ?? {}) },
        servername: isHttps ? url.hostname : undefined,
        family: check.family,
        timeout: options.timeoutMs,
      },
      (response) => {
        const chunks: Buffer[] = [];
        let size = 0;
        response.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > maxBytes + 1) {
            request.destroy();
            return;
          }
          chunks.push(chunk);
        });
        response.on('end', () => {
          resolve({
            statusCode: response.statusCode ?? 0,
            headers: response.headers,
            body: Buffer.concat(chunks),
          });
        });
        response.on('error', reject);
      },
    );
    request.setTimeout(options.timeoutMs, () => request.destroy(new Error('timeout')));
    request.on('error', reject);
    if (options.payload) request.write(options.payload);
    request.end();
  });
}

export type ImageFetch =
  | { kind: 'ok'; bytes: Buffer; mediaType: 'image/png' | 'image/jpeg' | 'image/webp' }
  | { kind: 'refused_address' }
  | { kind: 'unfetchable' }
  | { kind: 'not_an_image' }
  | { kind: 'too_large' };

function sniffImageType(bytes: Buffer): 'image/png' | 'image/jpeg' | 'image/webp' | null {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'image/png';
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString('latin1') === 'RIFF' &&
    bytes.subarray(8, 12).toString('latin1') === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

/** Fetches an image URL, re-checking every redirect hop, with at most 3 redirects and a 10 second budget. */
export async function fetchImage(raw: string): Promise<ImageFetch> {
  const deadline = Date.now() + 10000;
  let target = raw;
  for (let hop = 0; hop <= 3; hop += 1) {
    const check = await checkUrl(target);
    if (check.kind === 'refused') return { kind: 'refused_address' };
    const remaining = deadline - Date.now();
    if (remaining <= 0) return { kind: 'unfetchable' };
    let response: OutboundResponse;
    try {
      response = await requestChecked(check, {
        method: 'GET',
        timeoutMs: remaining,
        headers: { accept: 'image/png, image/jpeg, image/webp' },
        maxBytes: UPLOAD_LIMIT,
      });
    } catch {
      return { kind: 'unfetchable' };
    }
    if (response.statusCode >= 300 && response.statusCode < 400) {
      const location = response.headers.location;
      if (!location || hop === 3) return { kind: 'unfetchable' };
      target = new URL(location, check.url).toString();
      continue;
    }
    if (response.statusCode < 200 || response.statusCode >= 300) return { kind: 'unfetchable' };
    if (response.body.length > UPLOAD_LIMIT) return { kind: 'too_large' };
    const mediaType = sniffImageType(response.body);
    if (!mediaType) return { kind: 'not_an_image' };
    return { kind: 'ok', bytes: response.body, mediaType };
  }
  return { kind: 'unfetchable' };
}

export type WebhookAttempt = { kind: 'answered'; statusCode: number } | { kind: 'no_answer' };

/** One webhook attempt: no redirects, and only a 2xx inside five seconds counts as delivered. */
export async function deliverWebhook(
  url: string,
  body: string,
  headers: Record<string, string>,
): Promise<WebhookAttempt> {
  const check = await checkUrl(url);
  if (check.kind === 'refused') return { kind: 'no_answer' };
  try {
    const response = await requestChecked(check, {
      method: 'POST',
      timeoutMs: 5000,
      headers: { ...headers, 'content-length': String(Buffer.byteLength(body, 'utf8')) },
      payload: Buffer.from(body, 'utf8'),
      maxBytes: 65536,
    });
    return { kind: 'answered', statusCode: response.statusCode };
  } catch {
    return { kind: 'no_answer' };
  }
}
