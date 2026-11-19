import { createReadStream, existsSync, statSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { userFor } from './auth';
import {
  forkSource, guideBySlug, isMember, readingContent, readingJson, roleOf, visibleTo, workingJson, type GuideRecord,
} from './content';
import { one, pool } from './db';
import { framingHeaders } from './http';
import { SAMPLES_DIR } from './seed';
import { pageText } from '../shared/copy';
import type { User } from '../shared/types';

const PUBLIC_DIR = join(import.meta.dirname, 'public');

const types: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.woff2': 'font/woff2', '.glb': 'model/gltf-binary',
  '.svg': 'image/svg+xml', '.png': 'image/png',
};

export function serveStatic(req: IncomingMessage, res: ServerResponse, path: string): boolean {
  const fromSamples = path.startsWith('/samples/');
  const root = fromSamples ? SAMPLES_DIR : PUBLIC_DIR;
  const relative = normalize(decodeURIComponent(fromSamples ? path.slice('/samples/'.length) : path.slice(1)));
  if (relative.startsWith('..') || (!fromSamples && !path.startsWith('/assets/'))) return false;
  const file = join(root, relative);
  if (!file.startsWith(root) || !existsSync(file) || !statSync(file).isFile()) return false;
  res.writeHead(200, {
    'Content-Type': types[extname(file)] ?? 'application/octet-stream',
    'Content-Length': statSync(file).size,
    'Cache-Control': extname(file) === '.woff2' ? 'public, max-age=86400' : 'no-cache',
  });
  if (req.method === 'HEAD') res.end();
  else createReadStream(file).pipe(res);
  return true;
}

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function shell(title: string, body: string, boot: object | null, embed: boolean): string {
  const data = boot ? `<script id="boot" type="application/json">${JSON.stringify(boot).replace(/</g, '\\u003c')}</script>` : '';
  return `<!doctype html>
<html lang="en"${embed ? ' data-embed="true"' : ''}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<link rel="stylesheet" href="/assets/app.css">
</head>
<body>
${body}
${data}
<script type="module" src="/assets/app.js"></script>
</body>
</html>`;
}

function bandPage(message: string, embed: boolean): string {
  return shell(
    'Pennywasher Works',
    `<main class="error-band"><a class="wordmark" href="/">Pennywasher</a><p class="error-band-text">${escapeHtml(message)}</p><a class="band-link" href="/">Go to the home page</a></main>`,
    null,
    embed,
  );
}

function send(res: ServerResponse, status: number, html: string, embed: boolean, headers: Record<string, string> = {}): void {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', ...framingHeaders(embed), ...headers });
  res.end(html);
}

export function notFoundPage(res: ServerResponse, embed = false): void {
  send(res, 404, bandPage(pageText.notFound, embed), embed);
}

const withdrawnPage = (res: ServerResponse, embed: boolean) => send(res, 410, bandPage(pageText.withdrawn, embed), embed);

async function readerBoot(guide: GuideRecord, user: User | null) {
  const content = await readingContent(pool, guide);
  if (!content) return null;
  const liked = user ? !!(await one(pool, 'SELECT 1 FROM likes WHERE guide_id = $1 AND user_id = $2', [guide.id, user.id])) : false;
  const source = await forkSource(pool, guide, (g) => roleOf(pool, g, user));
  return readingJson(pool, guide, content, liked, source);
}

/** Pages that carry data decide their status here: the same visibility rules as the API, one place. */
export async function handlePage(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const match = /^\/(g|edit|embed|c)\/([^/]+)$/.exec(path);
  const embed = match?.[1] === 'embed';
  const user = embed ? null : await userFor(req);
  if (match) {
    const slug = decodeURIComponent(match[2]!);
    if (match[1] === 'c') {
      const row = await one<{ id: string; owner_id: string; visibility: string }>(pool, 'SELECT id, owner_id, visibility FROM collections WHERE slug = $1', [slug]);
      if (!row || (row.visibility === 'private' && row.owner_id !== user?.id)) return notFoundPage(res), true;
      send(res, 200, shell('Collection · Pennywasher Works', '<div id="app"></div>', { page: 'collection', id: row.id, ownerId: row.owner_id, user }, false), false);
      return true;
    }
    const guide = await guideBySlug(pool, slug);
    const role = guide ? await roleOf(pool, guide, user) : 'none';
    if (!guide || (embed ? guide.visibility !== 'public' || guide.state === 'draft' : !visibleTo(guide, role))) return notFoundPage(res, embed), true;
    if (match[1] === 'edit') {
      if (!isMember(role)) return notFoundPage(res), true;
      send(res, 200, shell(`${guide.title} · Pennywasher Works`, '<div id="app"></div>', { page: 'editor', user, role, working: await workingJson(pool, guide) }, false), false);
      return true;
    }
    if (guide.state === 'withdrawn') return withdrawnPage(res, embed), true;
    const reading = await readerBoot(guide, user);
    if (!reading || (embed && guide.state !== 'published')) return notFoundPage(res, embed), true;
    send(res, 200, shell(`${guide.title} · Pennywasher Works`, '<div id="app"></div>', { page: embed ? 'embed' : 'reader', user, guide: reading }, embed), embed);
    return true;
  }
  const simple = ['/', '/search', '/signin', '/signup', '/confirm', '/dashboard'];
  if (!simple.includes(path)) return false;
  if (path === '/dashboard' && !user) {
    res.writeHead(302, { Location: '/signin?next=/dashboard', ...framingHeaders(false) });
    res.end();
    return true;
  }
  if (path === '/confirm' && !user && !url.searchParams.has('token')) {
    res.writeHead(302, { Location: '/signin?next=/confirm', ...framingHeaders(false) });
    res.end();
    return true;
  }
  let boot: object = { page: path === '/' ? 'home' : path.slice(1), user };
  if (path === '/') {
    const home = await guideBySlug(pool, 'coffee-grinder-fit-new-burrs');
    const reading = home && home.state === 'published' ? await readerBoot(home, user) : null;
    boot = { page: 'home', user, guide: reading };
  }
  send(res, 200, shell('Pennywasher Works', '<div id="app"></div>', boot, false), false);
  return true;
}

