import { lookup } from 'node:dns';
import * as http from 'node:http';
import * as https from 'node:https';
import { config, limits } from '../config';
import { classifyAddress, isIpLiteral } from '../../shared/address';
import { findFirstAddress } from '../../shared/links';
import type { Unfurl } from '../../shared/types';

export interface LinkStage {
  verdict: string;
  url: string | null;
  address: string | null;
  unfurl: Unfurl | null;
}

const NO_LINK: LinkStage = { verdict: 'no link', url: null, address: null, unfurl: null };

function defaultPort(protocol: string): string {
  return protocol === 'https:' ? '443' : '80';
}

function portOf(url: URL): string {
  return url.port === '' ? defaultPort(url.protocol) : url.port;
}

/** The open-web stand-in: its own `/web/` pages count as public. */
function isStandInPage(url: URL): boolean {
  if (config.wiremockUrl === '') return false;
  let stand: URL;
  try {
    stand = new URL(config.wiremockUrl);
  } catch {
    return false;
  }
  return (
    url.protocol === stand.protocol &&
    url.hostname === stand.hostname &&
    portOf(url) === portOf(stand) &&
    url.pathname.startsWith('/web/')
  );
}

function resolveHost(hostname: string): Promise<string | null> {
  const literal = hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname;
  if (isIpLiteral(hostname)) return Promise.resolve(literal);
  return new Promise((resolve) => {
    lookup(hostname, { verbatim: true }, (error, address) => {
      resolve(error ? null : address);
    });
  });
}

interface PinnedResponse {
  status: number;
  location: string | null;
  contentType: string;
  body: Buffer;
  tooLarge: boolean;
}

function fetchPinned(url: URL, address: string, deadline: number): Promise<PinnedResponse | 'timeout' | 'error'> {
  return new Promise((resolve) => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      resolve('timeout');
      return;
    }
    const agent = url.protocol === 'https:' ? https : http;
    const isIpv6 = address.includes(':');
    const request = agent.request(
      {
        host: isIpv6 ? `[${address}]` : address,
        port: Number(portOf(url)),
        path: `${url.pathname}${url.search}`,
        method: 'GET',
        headers: { Host: url.host, Accept: 'text/html', 'Accept-Encoding': 'identity' },
        servername: url.hostname,
        timeout: remaining,
      },
      (response) => {
        const chunks: Buffer[] = [];
        let total = 0;
        let tooLarge = false;
        response.on('data', (chunk: Buffer) => {
          total += chunk.length;
          if (total > limits.unfurlBytes) {
            tooLarge = true;
            response.destroy();
            return;
          }
          chunks.push(chunk);
        });
        response.on('end', () => {
          resolve({
            status: response.statusCode ?? 0,
            location: response.headers.location ?? null,
            contentType: String(response.headers['content-type'] ?? ''),
            body: Buffer.concat(chunks),
            tooLarge,
          });
        });
        response.on('close', () => {
          if (tooLarge) {
            resolve({
              status: response.statusCode ?? 0,
              location: null,
              contentType: String(response.headers['content-type'] ?? ''),
              body: Buffer.concat(chunks),
              tooLarge: true,
            });
          }
        });
        response.on('error', () => resolve('error'));
      },
    );
    const timer = setTimeout(() => {
      request.destroy();
      resolve('timeout');
    }, Math.max(1, remaining));
    request.on('error', () => {
      clearTimeout(timer);
      resolve('error');
    });
    request.on('close', () => clearTimeout(timer));
    request.end();
  });
}

function decodeEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_match, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

function metaContent(html: string, property: string): string | null {
  const pattern = new RegExp(
    `<meta[^>]+(?:property|name)\\s*=\\s*["']${property}["'][^>]*>`,
    'i',
  );
  const tag = pattern.exec(html);
  if (!tag) return null;
  const content = /content\s*=\s*["']([^"']*)["']/i.exec(tag[0]);
  return content ? decodeEntities(content[1] ?? '') : null;
}

function pageTitle(html: string): string | null {
  const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return match ? decodeEntities((match[1] ?? '').trim()) : null;
}

/** Reads the first address in the sanitised text and settles the link stage. */
export async function resolveLinkStage(after: string): Promise<LinkStage> {
  const found = findFirstAddress(after);
  if (!found) return NO_LINK;
  const messageUrl = found.url;
  const deadline = Date.now() + limits.unfurlTimeoutMs;
  let current = messageUrl;
  let address: string | null = null;
  let redirects = 0;

  for (;;) {
    let url: URL;
    try {
      url = new URL(current);
    } catch {
      return { verdict: 'failed: unreachable', url: messageUrl, address, unfurl: null };
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return { verdict: 'failed: unreachable', url: messageUrl, address, unfurl: null };
    }
    const resolved = await resolveHost(url.hostname);
    if (resolved === null) {
      return { verdict: 'failed: unreachable', url: messageUrl, address, unfurl: null };
    }
    address = resolved;
    if (!isStandInPage(url)) {
      const refusal = classifyAddress(resolved);
      if (refusal) return { verdict: `refused: ${refusal}`, url: messageUrl, address, unfurl: null };
    }

    const response = await fetchPinned(url, resolved, deadline);
    if (response === 'timeout') {
      return { verdict: 'failed: timed out', url: messageUrl, address, unfurl: null };
    }
    if (response === 'error') {
      return { verdict: 'failed: unreachable', url: messageUrl, address, unfurl: null };
    }
    if (response.tooLarge) {
      return { verdict: 'failed: too large', url: messageUrl, address, unfurl: null };
    }
    const redirectStatus = [301, 302, 303, 307, 308].includes(response.status);
    if (redirectStatus && response.location !== null) {
      redirects += 1;
      if (redirects > limits.maxRedirects) {
        return { verdict: 'refused: too many redirects', url: messageUrl, address, unfurl: null };
      }
      try {
        current = new URL(response.location, url).toString();
      } catch {
        return { verdict: 'failed: unreachable', url: messageUrl, address, unfurl: null };
      }
      continue;
    }
    if (response.status < 200 || response.status > 299) {
      return { verdict: 'failed: unreachable', url: messageUrl, address, unfurl: null };
    }
    const essence = (response.contentType.split(';')[0] ?? '').trim().toLowerCase();
    if (essence !== 'text/html') {
      return { verdict: 'failed: not a page', url: messageUrl, address, unfurl: null };
    }
    const html = response.body.toString('utf8');
    const title = (metaContent(html, 'og:title') ?? pageTitle(html) ?? '').slice(0, 200);
    const description = metaContent(html, 'og:description');
    return {
      verdict: 'fetched',
      url: messageUrl,
      address,
      unfurl: {
        url: messageUrl,
        title,
        description: description === null ? null : description.slice(0, 300),
      },
    };
  }
}
