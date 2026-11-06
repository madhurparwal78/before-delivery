// What a browser gets for a page address: the app's one shell, with the right status, language and first heading.

import { createReadStream, statSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { fileURLToPath } from 'node:url';
import { PRIVATE_COPY, type Language } from '../shared/copy';
import { one, pool } from './db';
import { isUuid } from './http';
import { readSession, type SessionRead } from './session';
import { escapeHtml } from './gotenberg';
import { isPageOpen, pageByToken } from './routes/pages';

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));
const ASSETS = new Map([
  ['/assets/app.js', { file: here('./assets/app.js'), type: 'text/javascript; charset=utf-8' }],
  ['/assets/app.css', { file: here('./assets/app.css'), type: 'text/css; charset=utf-8' }],
]);
for (const name of [
  'libre-franklin-latin-600-normal', 'libre-franklin-latin-700-normal', 'libre-franklin-latin-ext-600-normal', 'libre-franklin-latin-ext-700-normal',
  'source-serif-4-latin-400-normal', 'source-serif-4-latin-600-normal', 'source-serif-4-latin-ext-400-normal', 'source-serif-4-latin-ext-600-normal',
  'noto-naskh-arabic-arabic-400-normal', 'noto-naskh-arabic-arabic-700-normal',
]) {
  ASSETS.set(`/assets/fonts/${name}.woff2`, { file: here(`../public/fonts/${name}.woff2`), type: 'font/woff2' });
}

const FAVICON = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path fill="#c8102e" d="M5 0h11l-5 16H0z"/></svg>')}`;

const CONTENT_SECURITY = [
  "default-src 'self'",
  // The one inline script allowed is the accessibility audit (axe) by its exact hash; the app has none of its own.
  "script-src 'self' 'sha256-IMCf4Veoo0ow4kGqofza3mV3NPCKs3ns++t9RcxG6Hg='",
  "img-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

interface Shell {
  status: number;
  title: string;
  heading: string;
  language: Language;
}

const PUBLIC_HEADINGS: Record<string, string> = {
  '/': 'Boards drawn to the frame',
  '/reel': 'Work on the reel',
  '/how-it-works': 'How the work runs',
  '/sign-in': 'Sign in',
  '/sign-up': 'Start a desk',
};

const JOB_SCREENS = new Set(['script', 'reel', 'lines', 'cues', 'cuts', 'compare', 'notes', 'delivery', 'letter']);
const NOT_FOUND: Shell = { status: 404, title: 'Page not found', heading: 'Page not found', language: 'en' };

function shellHtml(shell: Shell): string {
  const dir = shell.language === 'ar' ? ' dir="rtl"' : ' dir="ltr"';
  const title = `${escapeHtml(shell.title)} — Clapstick`;
  // An Arabic page's text must not paint in a fallback and reflow when its own face arrives.
  const arabicFonts = shell.language === 'ar'
    ? ['400', '700'].map((weight) => `<link rel="preload" href="/assets/fonts/noto-naskh-arabic-arabic-${weight}-normal.woff2" as="font" type="font/woff2" crossorigin>\n`).join('')
    : '';
  const firstHeading = shell.heading ? `<main class="first-paint"><h1>${escapeHtml(shell.heading)}</h1></main>` : '';
  return `<!doctype html>
<html lang="${shell.language}"${dir}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="clapstick-status" content="${shell.status}">
<title>${title}</title>
<link rel="icon" href="${FAVICON}">
<link rel="preload" href="/assets/fonts/libre-franklin-latin-700-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/assets/fonts/source-serif-4-latin-400-normal.woff2" as="font" type="font/woff2" crossorigin>
${arabicFonts}<link rel="stylesheet" href="/assets/app.css">
<script type="module" src="/assets/app.js"></script>
</head>
<body>
<div id="announcements" role="status" aria-label="Announcements" class="sr-only"></div>
<div id="app">${firstHeading}</div>
<div id="overlays"></div>
</body>
</html>
`;
}

async function deskScreen(path: string, session: SessionRead): Promise<Shell> {
  const signedIn = session.state === 'live' ? session.desk : null;
  if (!signedIn) throw new Error('caller checks the session');
  const blank = (status = 200): Shell => ({ status, title: 'Clapstick', heading: '', language: 'en' });
  const parts = path.split('/').filter(Boolean);
  if (parts.length === 2 && ['jobs', 'clients', 'calls'].includes(parts[1] as string)) return blank();
  if (parts[1] === 'clients' && parts.length === 3 && isUuid(parts[2])) {
    const client = await one(pool, `SELECT 1 FROM clients WHERE id = $1 AND desk_id = $2 AND state <> 'erased'`, [parts[2], signedIn.id]);
    return client ? blank() : NOT_FOUND;
  }
  if (parts[1] === 'jobs' && isUuid(parts[2]) && (parts.length === 3 || (parts.length === 4 && JOB_SCREENS.has(parts[3] as string)))) {
    const job = await one(pool, `SELECT 1 FROM jobs j JOIN clients c ON c.id = j.client_id WHERE j.id = $1 AND j.desk_id = $2 AND c.state <> 'erased'`, [parts[2], signedIn.id]);
    return job ? blank() : NOT_FOUND;
  }
  return NOT_FOUND;
}

async function privateScreen(path: string, now: number): Promise<Shell> {
  const [, prefix, token, extra] = path.split('/');
  if (extra !== undefined) return NOT_FOUND;
  const kind = prefix === 'r' ? 'review' : prefix === 's' ? 'signOff' : 'fee';
  try {
    const found = await pageByToken(kind, token);
    const language = kind === 'fee' ? 'en' : found.language;
    const open = isPageOpen(found, now);
    const ended = PRIVATE_COPY[language].ended;
    return { status: open ? 200 : 410, title: open ? 'Clapstick' : ended, heading: open ? '' : ended, language };
  } catch {
    return NOT_FOUND;
  }
}

function sendShell(res: ServerResponse, shell: Shell): void {
  res.statusCode = shell.status;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Security-Policy', CONTENT_SECURITY);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(shellHtml(shell));
}

export function serveAsset(res: ServerResponse, path: string): boolean {
  const asset = ASSETS.get(path);
  if (!asset) return false;
  res.statusCode = 200;
  res.setHeader('Content-Type', asset.type);
  res.setHeader('Content-Length', statSync(asset.file).size);
  res.setHeader('Cache-Control', path.includes('/fonts/') ? 'public, max-age=31536000, immutable' : 'no-cache');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  createReadStream(asset.file).pipe(res);
  return true;
}

export async function serveDocument(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const path = url.pathname.length > 1 ? url.pathname.replace(/\/$/, '') : url.pathname;
  const heading = PUBLIC_HEADINGS[path];
  if (heading) {
    sendShell(res, { status: 200, title: heading, heading, language: 'en' });
    return;
  }
  if (path === '/desk' || path.startsWith('/desk/')) {
    const session = await readSession(req);
    if (session.state !== 'live') {
      res.statusCode = 302;
      res.setHeader('Location', `/sign-in?next=${encodeURIComponent(path + url.search)}`);
      res.setHeader('Cache-Control', 'no-store');
      res.end();
      return;
    }
    sendShell(res, await deskScreen(path, session));
    return;
  }
  if (/^\/[rsf]\/[^/]+$/.test(path)) {
    sendShell(res, await privateScreen(path, Date.now()));
    return;
  }
  sendShell(res, NOT_FOUND);
}

