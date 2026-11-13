import { readFileSync } from 'node:fs';
import type { ServerResponse } from 'node:http';
import { join } from 'node:path';
import { clientConfig } from './config';
import type { SessionUser } from './http/context';

const PUBLIC_DIR = join(__dirname, '..', 'public');

const ASSETS: Readonly<Record<string, { file: string; type: string }>> = {
  '/app.js': { file: 'app.js', type: 'text/javascript; charset=utf-8' },
  '/app.css': { file: 'app.css', type: 'text/css; charset=utf-8' },
  '/fonts/literata-latin-400-normal.woff2': { file: 'fonts/literata-latin-400-normal.woff2', type: 'font/woff2' },
  '/fonts/literata-latin-500-normal.woff2': { file: 'fonts/literata-latin-500-normal.woff2', type: 'font/woff2' },
  '/fonts/literata-latin-600-normal.woff2': { file: 'fonts/literata-latin-600-normal.woff2', type: 'font/woff2' },
  '/fonts/literata-latin-700-normal.woff2': { file: 'fonts/literata-latin-700-normal.woff2', type: 'font/woff2' },
  '/fonts/literata-latin-400-italic.woff2': { file: 'fonts/literata-latin-400-italic.woff2', type: 'font/woff2' },
};

const cache = new Map<string, Buffer>();

function assetBytes(file: string): Buffer {
  const cached = cache.get(file);
  if (cached) return cached;
  const bytes = readFileSync(join(PUBLIC_DIR, file));
  cache.set(file, bytes);
  return bytes;
}

export function serveAsset(pathname: string, res: ServerResponse): boolean {
  const asset = ASSETS[pathname];
  if (!asset) return false;
  const bytes = assetBytes(asset.file);
  res.writeHead(200, {
    'content-type': asset.type,
    'content-length': bytes.length,
    'cache-control': 'public, max-age=3600',
  });
  res.end(bytes);
  return true;
}

type PageGuard = 'public' | 'member' | 'moderator' | 'team' | 'founder';

interface PageRule {
  segments: ReadonlyArray<string>;
  guard: PageGuard;
}

const PAGES: ReadonlyArray<PageRule> = [
  { segments: [], guard: 'public' },
  { segments: ['sign-in'], guard: 'public' },
  { segments: ['join'], guard: 'public' },
  { segments: ['join', 'confirm'], guard: 'public' },
  { segments: ['forgot-password'], guard: 'public' },
  { segments: ['reset-password'], guard: 'public' },
  { segments: ['jobs'], guard: 'public' },
  { segments: ['jobs', '*'], guard: 'public' },
  { segments: ['jobs', '*', 'apply'], guard: 'member' },
  { segments: ['companies'], guard: 'public' },
  { segments: ['companies', '*'], guard: 'public' },
  { segments: ['companies', '*', 'reviews', '*'], guard: 'public' },
  { segments: ['contribute'], guard: 'member' },
  { segments: ['contribute', 'review'], guard: 'member' },
  { segments: ['contribute', 'pay'], guard: 'member' },
  { segments: ['contribute', 'interview'], guard: 'member' },
  { segments: ['me', 'contributions'], guard: 'member' },
  { segments: ['saved'], guard: 'member' },
  { segments: ['alerts'], guard: 'member' },
  { segments: ['applications'], guard: 'member' },
  { segments: ['applications', '*'], guard: 'member' },
  { segments: ['channels'], guard: 'member' },
  { segments: ['channels', '*'], guard: 'member' },
  { segments: ['moderation'], guard: 'moderator' },
  { segments: ['employer'], guard: 'team' },
  { segments: ['employer', 'jobs', 'new'], guard: 'team' },
  { segments: ['employer', 'jobs', '*'], guard: 'team' },
  { segments: ['employer', 'applications', '*'], guard: 'team' },
  { segments: ['founder'], guard: 'founder' },
];

function allowed(guard: PageGuard, user: SessionUser | null): boolean {
  switch (guard) {
    case 'public':
      return true;
    case 'member':
      return user?.role === 'member';
    case 'moderator':
      return user?.role === 'moderator' || user?.role === 'founder';
    case 'team':
      return user?.role === 'employer_admin' || user?.role === 'recruiter';
    case 'founder':
      return user?.role === 'founder';
  }
}

/** Unknown and hidden pages are served with 404. */
export function pageStatus(pathname: string, user: SessionUser | null): 200 | 404 {
  const parts = pathname.split('/').filter((part) => part.length > 0);
  for (const page of PAGES) {
    if (page.segments.length !== parts.length) continue;
    if (page.segments.every((segment, index) => segment === '*' || segment === parts[index])) {
      /** A signed-out visitor is sent to sign in rather than a dead end. */
      return allowed(page.guard, user) || user === null ? 200 : 404;
    }
  }
  return 404;
}

export function serveDocument(res: ServerResponse, status: 200 | 404): void {
  const html = assetBytes('index.html').toString('utf8').replace('"__CLIENT_CONFIG__"', JSON.stringify(clientConfig()));
  const payload = Buffer.from(html, 'utf8');
  res.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'content-length': payload.length,
    'cache-control': 'no-store',
  });
  res.end(payload);
}
