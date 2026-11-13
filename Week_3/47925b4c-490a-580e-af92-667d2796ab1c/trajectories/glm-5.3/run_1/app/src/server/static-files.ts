// Static files: the app shell, its assets and the service worker; never source,
// dot-files, the manifest, dependency folders or credentials.

import type { ServerResponse } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, normalize } from 'node:path';
import { problems } from '../shared/problems.js';

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.webmanifest': 'application/manifest+json',
  '.ico': 'image/x-icon',
};

export class StaticFiles {
  constructor(private readonly root: string) {}

  private forbid(segments: string[]): boolean {
    const first = segments[0] ?? '';
    if (first === 'node_modules' || first === 'dist' || first === 'src' || first === 'scripts' || first === 'server') return true;
    return false;
  }

  async serve(pathname: string, res: ServerResponse): Promise<boolean> {
    if (pathname.includes('..')) {
      sendProblem(res, problems.notFound());
      return true;
    }
    const clean = normalize(pathname).replace(/^(\.\.[/\\])+/, '');
    const segments = clean
      .split('/')
      .filter((s) => s !== '' && s !== '.')
      .map((s) => safeDecode(s));
    if (segments.some((s) => s.startsWith('.'))) {
      sendProblem(res, problems.notFound());
      return true;
    }
    if (this.forbid(segments)) {
      sendProblem(res, problems.notFound());
      return true;
    }
    let target = join(this.root, ...segments);
    let info;
    try {
      info = await stat(target);
    } catch {
      info = null;
    }
    if (info === null) {
      // SPA fallback: every route is a real address
      if (!pathname.includes('.')) {
        const index = await readFile(join(this.root, 'index.html'));
        sendBytes(res, 200, index, CONTENT_TYPES['.html']!);
        return true;
      }
      sendProblem(res, problems.notFound());
      return true;
    }
    if (info.isDirectory()) {
      target = join(target, 'index.html');
      try {
        info = await stat(target);
      } catch {
        sendProblem(res, problems.notFound());
        return true;
      }
    }
    const bytes = await readFile(target);
    const extension = target.slice(target.lastIndexOf('.'));
    const type = CONTENT_TYPES[extension] ?? 'application/octet-stream';
    sendBytes(res, 200, bytes, type);
    return true;
  }
}

function safeDecode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function sendBytes(res: ServerResponse, status: number, body: Buffer, contentType: string): void {
  res.writeHead(status, {
    'Content-Type': contentType,
    'Content-Length': String(body.length),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  });
  res.end(body);
}

function sendProblem(res: ServerResponse, problem: ReturnType<typeof problems.notFound>): void {
  const body = JSON.stringify({
    type: `urn:gevelwerk:problem:${problem.code}`,
    title: problem.code,
    status: problem.status,
    detail: 'Nothing here.',
    code: problem.code,
  });
  res.writeHead(problem.status, {
    'Content-Type': 'application/problem+json; charset=utf-8',
    'Content-Length': String(Buffer.byteLength(body)),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}
