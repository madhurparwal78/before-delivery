import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import type { ServerResponse } from 'node:http';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../client/', import.meta.url));

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.webm': 'video/webm',
  '.mp4': 'video/mp4',
  '.wav': 'audio/wav',
  '.vtt': 'text/vtt; charset=utf-8',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
};

/** The five page addresses, each served by its built page. */
const PAGES: Record<string, string> = {
  '/': 'index.html',
  '/manage': 'manage.html',
  '/signin': 'signin.html',
  '/privacy': 'privacy.html',
};

export const NOT_FOUND_PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Not here · Stillhour</title>
<link rel="icon" href="/favicon.svg">
<style>
 body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0b0914;color:#f5eee6;
 font-family:'Hanken Grotesk',system-ui,sans-serif;text-align:center;padding:2rem}
 a{color:#ff8a3d}
</style></head>
<body><main><h1>This page is not here.</h1><p><a href="/">Back to Stillhour</a></p></main></body></html>
`;

function resolve(pathname: string): string | null {
  const page = PAGES[pathname];
  if (page) return join(ROOT, page);
  if (/^\/p\/[^/]+$/.test(pathname)) return join(ROOT, 'partner.html');
  const decoded = decodeURIComponent(pathname);
  if (decoded.includes('\0')) return null;
  const candidate = normalize(join(ROOT, decoded));
  if (!candidate.startsWith(ROOT) || candidate.endsWith(sep)) return null;
  return candidate;
}

interface Served {
  status: number;
  headers: Record<string, string>;
  stream?: NodeJS.ReadableStream;
}

/** Serves the built pages and assets only, with byte ranges for the film and clips. */
export async function serveStatic(pathname: string, range: string | undefined): Promise<Served | null> {
  const file = resolve(pathname);
  if (!file) return null;
  let info;
  try {
    info = await stat(file);
  } catch {
    return null;
  }
  if (!info.isFile()) return null;

  const type = TYPES[extname(file).toLowerCase()];
  if (!type) return null;
  const immutable = pathname.startsWith('/assets/') || pathname.startsWith('/fonts/');
  const headers: Record<string, string> = {
    'content-type': type,
    'accept-ranges': 'bytes',
    'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
  };

  const match = range ? /^bytes=(\d*)-(\d*)$/.exec(range.trim()) : null;
  if (match) {
    const hasStart = match[1] !== '';
    const start = hasStart ? Number(match[1]) : Math.max(0, info.size - Number(match[2]));
    const end = hasStart && match[2] !== '' ? Math.min(Number(match[2]), info.size - 1) : info.size - 1;
    if (start > end || start >= info.size) {
      return { status: 416, headers: { ...headers, 'content-range': `bytes */${info.size}` } };
    }
    return {
      status: 206,
      headers: {
        ...headers,
        'content-range': `bytes ${start}-${end}/${info.size}`,
        'content-length': String(end - start + 1),
      },
      stream: createReadStream(file, { start, end }),
    };
  }

  return {
    status: 200,
    headers: { ...headers, 'content-length': String(info.size) },
    stream: createReadStream(file),
  };
}

export function sendServed(res: ServerResponse, served: Served, method: string): void {
  res.writeHead(served.status, served.headers);
  if (method === 'HEAD' || !served.stream) {
    res.end();
    (served.stream as { destroy?: () => void } | undefined)?.destroy?.();
    return;
  }
  served.stream.pipe(res);
}
