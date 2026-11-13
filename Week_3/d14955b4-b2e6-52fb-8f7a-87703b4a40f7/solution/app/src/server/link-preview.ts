import http from 'node:http';
import https from 'node:https';
import { findAddresses } from '../shared/links.js';
import { resolveLink } from './address.js';

const FETCH_LIMIT_BYTES = 524_288;
const FETCH_LIMIT_MS = 3000;
const MAX_REDIRECTS = 3;
const TITLE_CHARS = 200;
const DESCRIPTION_CHARS = 300;

export interface LinkOutcome {
  verdict: string;
  url: string | null;
  address: string | null;
  preview: { title: string; description: string | null } | null;
}

class FetchFailure extends Error {}

type Hop = { kind: 'page'; body: string } | { kind: 'redirect'; location: string };

function fetchHop(url: URL, address: string, family: 4 | 6, deadline: number): Promise<Hop> {
  return new Promise((resolve, reject) => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) return reject(new FetchFailure('failed: timed out'));
    const send = url.protocol === 'https:' ? https.request : http.request;
    const request = send(
      {
        host: url.hostname.replace(/^\[|\]$/g, ''),
        port: url.port || undefined,
        path: `${url.pathname}${url.search}`,
        method: 'GET',
        headers: { Accept: 'text/html', 'User-Agent': 'Hushline-link-preview' },
        lookup: (_host, options, callback) => {
          if (options.all) (callback as (error: null, addresses: { address: string; family: number }[]) => void)(null, [{ address, family }]);
          else (callback as (error: null, address: string, family: number) => void)(null, address, family);
        },
      },
      (response) => {
        const status = response.statusCode ?? 0;
        const location = response.headers.location;
        if (status >= 300 && status < 400 && location) {
          response.resume();
          return resolve({ kind: 'redirect', location });
        }
        if (status < 200 || status >= 300 || !/^text\/html/i.test(response.headers['content-type'] ?? '')) {
          response.resume();
          return reject(new FetchFailure('failed: not a page'));
        }
        const chunks: Buffer[] = [];
        let size = 0;
        response.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > FETCH_LIMIT_BYTES) {
            request.destroy();
            reject(new FetchFailure('failed: too large'));
          } else chunks.push(chunk);
        });
        response.on('end', () => resolve({ kind: 'page', body: Buffer.concat(chunks).toString('utf8') }));
        response.on('error', () => reject(new FetchFailure('failed: unreachable')));
      },
    );
    const timer = setTimeout(() => {
      request.destroy();
      reject(new FetchFailure('failed: timed out'));
    }, remaining);
    request.on('close', () => clearTimeout(timer));
    request.on('error', () => reject(new FetchFailure('failed: unreachable')));
    request.end();
  });
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, entity: string) => {
    if (entity[0] === '#') {
      const code = entity[1]?.toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[entity.toLowerCase()] ?? whole;
  });
}

function metaContent(html: string, property: string): string | null {
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const attributes = new Map<string, string>();
    for (const match of tag.matchAll(/([a-z:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) {
      attributes.set((match[1] as string).toLowerCase(), match[2] ?? match[3] ?? '');
    }
    const name = attributes.get('property') ?? attributes.get('name');
    if (name?.toLowerCase() === property && attributes.has('content')) return decodeEntities(attributes.get('content') as string);
  }
  return null;
}

const cut = (text: string, chars: number): string => [...text].slice(0, chars).join('');

function parsePreview(html: string): { title: string; description: string | null } {
  const titleTag = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const title = metaContent(html, 'og:title') ?? (titleTag ? decodeEntities(titleTag[1] as string).trim() : '');
  const description = metaContent(html, 'og:description');
  return { title: cut(title, TITLE_CHARS), description: description === null ? null : cut(description, DESCRIPTION_CHARS) };
}

export async function checkLink(after: string): Promise<LinkOutcome> {
  const first = findAddresses(after)[0];
  if (!first) return { verdict: 'no link', url: null, address: null, preview: null };
  const deadline = Date.now() + FETCH_LIMIT_MS;
  let address: string | null = null;
  let target = first.url;
  for (let redirects = 0; ; redirects += 1) {
    const resolved = await resolveLink(target);
    if (resolved.ok === false) {
      address = resolved.address ?? address;
      const verdict = resolved.class ? `refused: ${resolved.class}` : 'failed: unreachable';
      return { verdict, url: first.url, address, preview: null };
    }
    address = resolved.address;
    try {
      const hop = await fetchHop(resolved.url, resolved.address, resolved.family, deadline);
      if (hop.kind === 'page') return { verdict: 'fetched', url: first.url, address, preview: parsePreview(hop.body) };
      if (redirects === MAX_REDIRECTS) return { verdict: 'refused: too many redirects', url: first.url, address, preview: null };
      target = new URL(hop.location, resolved.url).href;
    } catch (error) {
      return { verdict: error instanceof FetchFailure ? error.message : 'failed: unreachable', url: first.url, address, preview: null };
    }
  }
}
