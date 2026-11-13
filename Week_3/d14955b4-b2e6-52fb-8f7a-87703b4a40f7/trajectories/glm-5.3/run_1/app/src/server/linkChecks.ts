import dns from 'node:dns/promises';
import net from 'node:net';
import { loadConfig } from './config';

// The one address-classing decision and the one fetch with redirect caps.

export type RefusalClass = 'metadata' | 'loopback' | 'private' | 'link-local' | 'shared' | 'reserved';

export interface AddressClassResult {
  verdict: 'refused' | 'public';
  class?: RefusalClass;
  address: string | null;
}

export function firstAddress(after: string): string | null {
  let best: string | null = null;
  const lowered = after.toLowerCase();
  let index = lowered.indexOf('http://');
  const httpsIndex = lowered.indexOf('https://');
  if (httpsIndex !== -1 && (index === -1 || httpsIndex < index)) index = httpsIndex;
  if (index === -1) return null;
  let end = index;
  while (end < after.length) {
    const code = after.charCodeAt(end);
    if (code === 32 || code === 9 || code === 10 || code === 13 || code === 60 || code === 62 || code === 34 || code === 39 || code === 41 || code === 93) break;
    end += 1;
  }
  while (end > index) {
    const tail = after[end - 1];
    if (tail === '.' || tail === ',' || tail === ';' || tail === ':' || tail === '!' || tail === '?') end -= 1;
    else break;
  }
  best = after.slice(index, end);
  return best;
}

export function classAddress(host: string): RefusalClass | 'public' {
  const address = host.startsWith('[') ? host.slice(1, host.indexOf(']')) : host;
  if (net.isIPv6(address)) {
    const normalised = address.toLowerCase();
    const mapped = normalised.startsWith('::ffff:') ? normalised.slice(7) : null;
    if (mapped && dottedIpv4(mapped)) return classAddress(mapped);
    if (normalised === '::1') return 'loopback';
    if (normalised === 'fd00:ec2::254') return 'metadata';
    if (normalised.startsWith('fc') || normalised.startsWith('fd')) return 'private';
    if (/^fe[89ab]/.test(normalised)) return 'link-local';
    if (normalised === '::') return 'reserved';
    return 'reserved';
  }
  const ipv4 = dottedIpv4(host);
  if (ipv4) {
    const [a, b] = ipv4;
    if (a === 169 && b === 254) return host === '169.254.169.254' ? 'metadata' : 'link-local';
    if (a === 127) return 'loopback';
    if (a === 10) return 'private';
    if (a === 172 && b >= 16 && b <= 31) return 'private';
    if (a === 192 && b === 168) return 'private';
    if (a === 100 && b >= 64 && b <= 127) return 'shared';
    if (a === 0) return 'reserved';
    if (a >= 224) return 'reserved';
    return 'public';
  }
  return 'reserved';
}

function expandIpv6(address: string): string[] | null {
  const parts = address.split('::');
  if (parts.length > 2) return null;
  const groups: string[] = [];
  const parse = (chunk: string) => {
    if (chunk === '') return [];
    return chunk.split(':').map((piece) => piece.padStart(4, '0'));
  };
  if (parts.length === 2) {
    const head = parse(parts[0]);
    const tail = parse(parts[1]);
    const missing = 8 - head.length - tail.length;
    if (missing < 0) return null;
    return [...head, ...new Array(missing).fill('0000'), ...tail];
  }
  return parse(parts[0]);
}

function dottedIpv4(host: string): [number, number] | null {
  const parts = host.split('.');
  if (parts.length !== 4) return null;
  const numbers: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    numbers.push(Number.parseInt(part, 10));
  }
  if (numbers.some((n) => n > 255)) return null;
  return [numbers[0], numbers[1]];
}

export async function resolveAndClass(urlText: string): Promise<AddressClassResult> {
  let url: URL;
  try {
    url = new URL(urlText);
  } catch {
    return { verdict: 'refused', class: 'reserved', address: null };
  }
  const host = url.hostname;
  const wiremock = new URL(loadConfig().wiremockUrl);
  const standIn = url.host === wiremock.host && url.pathname.startsWith('/web/');
  if (standIn) return { verdict: 'public', address: null };
  if (net.isIP(host) === 0) {
    try {
      const records = await dns.lookup(host, { all: true });
      if (records.length === 0) return { verdict: 'refused', class: 'reserved', address: null };
      const record = records[0];
      const klass = classAddress(record.address);
      return { verdict: klass === 'public' ? 'public' : 'refused', class: klass === 'public' ? undefined : (klass as RefusalClass), address: record.address };
    } catch {
      return { verdict: 'refused', class: 'reserved', address: null };
    }
  }
  const klass = classAddress(host);
  return { verdict: klass === 'public' ? 'public' : 'refused', class: klass === 'public' ? undefined : (klass as RefusalClass), address: host };
}

export async function fetchLink(urlText: string): Promise<{ verdict: string; address: string | null; title: string | null; description: string | null }> {
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), 3000);
  let current = urlText;
  let lastAddress: string | null = null;
  try {
    for (let redirects = 0; redirects <= 3; redirects += 1) {
      const check = await resolveAndClass(current);
      lastAddress = check.address ?? lastAddress;
      if (check.verdict === 'refused') {
        return { verdict: `refused: ${check.class}`, address: lastAddress, title: null, description: null };
      }
      let response: Response;
      try {
        response = await fetch(current, { redirect: 'manual', signal: controller.signal, headers: { 'user-agent': 'Hushline-Preview' } });
      } catch (error) {
        if (deadlineClosed(error)) return { verdict: 'failed: timed out', address: lastAddress, title: null, description: null };
        return { verdict: 'failed: unreachable', address: lastAddress, title: null, description: null };
      }
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        if (redirects === 3) return { verdict: 'refused: too many redirects', address: lastAddress, title: null, description: null };
        const location = response.headers.get('location');
        if (!location) return { verdict: 'failed: unreachable', address: lastAddress, title: null, description: null };
        const next = new URL(location, current).toString();
        current = next;
        continue;
      }
      const type = response.headers.get('content-type') ?? '';
      if (!response.ok || !type.includes('text/html')) {
        return { verdict: 'failed: not a page', address: lastAddress, title: null, description: null };
      }
      const reader = response.body?.getReader();
      if (!reader) return { verdict: 'failed: not a page', address: lastAddress, title: null, description: null };
      const chunks: Uint8Array[] = [];
      let received = 0;
      const limit = 524_288;
      while (true) {
        const step = await reader.read();
        if (step.done) break;
        chunks.push(step.value);
        received += step.value.length;
        if (received > limit) {
          await reader.cancel();
          return { verdict: 'failed: too large', address: lastAddress, title: null, description: null };
        }
      }
      const merged = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
      const page = merged.toString('utf8');
      const title = metaValue(page, 'og:title') || tagTitle(page) || '';
      const description = metaValue(page, 'og:description') || '';
      return {
        verdict: 'fetched',
        address: lastAddress,
        title: title === '' ? null : title.slice(0, 200),
        description: description === '' ? null : description.slice(0, 300),
      };
    }
    return { verdict: 'refused: too many redirects', address: lastAddress, title: null, description: null };
  } catch (error) {
    if (deadlineClosed(error)) return { verdict: 'failed: timed out', address: lastAddress, title: null, description: null };
    return { verdict: 'failed: unreachable', address: lastAddress, title: null, description: null };
  } finally {
    clearTimeout(deadline);
  }
}

function deadlineClosed(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError');
}

function metaValue(page: string, property: string): string {
  const match = page.match(new RegExp(`<meta[^>]+property=["']${property}["'][^>]*>`, 'i'));
  const tag = match?.[0] ?? '';
  const content = tag.match(/content=["']([^"']*)["']/i)?.[1] ?? '';
  return content;
}

function tagTitle(page: string): string {
  return page.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() ?? '';
}

export function sanitisedFirstLink(after: string): string | null {
  return firstAddress(after);
}

export async function classLinkForStorage(urlText: string): Promise<{ verdict: string; address: string | null; url: string } | null> {
  const result = await resolveAndClass(urlText);
  if (result.verdict === 'refused') {
    return { verdict: `refused: ${result.class}`, address: result.address, url: urlText };
  }
  const fetched = await fetchLink(urlText);
  return { verdict: fetched.verdict, address: fetched.address, url: urlText };
}
