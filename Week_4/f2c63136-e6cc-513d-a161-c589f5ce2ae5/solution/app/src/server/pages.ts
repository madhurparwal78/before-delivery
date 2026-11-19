import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import { config } from './config.ts';
import { db, type Row } from './db.ts';
import { mailpitReachable } from './mail.ts';
import { storageReachable } from './s3.ts';
import { sessionUser, roleOf } from './domain/access.ts';
import { parsePath, type PageRoute } from '../shared/routes.ts';
import type { PageBoot } from '../shared/types.ts';
import { postgresReachable } from './db.ts';
import { validRevisionId, validSlug } from './domain/validate.ts';

const readManifest = (): { js: string; css: string } => JSON.parse(readFileSync('dist/public/manifest.json', 'utf8'));

function shell(boot: PageBoot): string {
  const manifest = readManifest();
  const data = JSON.stringify(boot).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="en" data-diff-breakpoint="${config.diffBreakpointPx}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<title>Ridgestack</title>
<link rel="icon" href="data:,">
<link rel="stylesheet" href="${manifest.css}">
<link rel="preload" href="/fonts/inter-latin-wght-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/fonts/inter-tight-latin-wght-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/fonts/martian-mono-latin-wght-normal.woff2" as="font" type="font/woff2" crossorigin>
</head>
<body>
<div id="root"></div>
<script type="application/json" id="boot">${data}</script>
<script type="module" src="${manifest.js}"></script>
</body>
</html>`;
}

function page(res: ServerResponse, status: number, boot: PageBoot): void {
  res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  res.end(shell(boot));
}

/** Whether the address names something the caller can see; anything else is the not-found page. */
async function visible(route: PageRoute, userId: number): Promise<boolean> {
  if (!('org' in route)) return true;
  if (route.name === 'org') {
    const { organisationOf } = await import('./domain/access.ts');
    return organisationOf(db, route.org, userId).then(() => true, () => false);
  }
  if (!('repo' in route)) return true;
  const repo = (await db.q<Row>('SELECT r.* FROM repos r JOIN orgs o ON o.id = r.org_id WHERE o.slug = $1 AND r.name = $2', [route.org, route.repo]))[0];
  if (!repo || !(await roleOf(db, repo, userId))) return false;
  if (route.name === 'revision') return validRevisionId(route.id) && (await db.q('SELECT 1 FROM revisions WHERE repo_id = $1 AND id = $2', [repo.id, route.id])).length > 0;
  if (route.name === 'change') return (await db.q('SELECT 1 FROM changes WHERE repo_id = $1 AND number = $2', [repo.id, route.number])).length > 0;
  if (route.name === 'blob') {
    const head = (await db.q<Row>('SELECT revision FROM branches WHERE repo_id = $1 AND name = $2', [repo.id, route.branch]))[0];
    return !!head && (await db.q('SELECT 1 FROM revision_files WHERE repo_id = $1 AND revision_id = $2 AND path = $3', [repo.id, head.revision, route.path])).length > 0;
  }
  if (route.name === 'edit') return (await db.q('SELECT 1 FROM branches WHERE repo_id = $1 AND name = $2', [repo.id, route.branch])).length > 0;
  return true;
}

export async function servePage(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const route = parsePath(url.pathname);
  const user = await sessionUser(req);
  const base: PageBoot = {
    user: user ? { username: user.username, name: user.name } : null,
    notFound: false,
    breakpoint: config.diffBreakpointPx,
    services: null,
  };
  if (!route) return page(res, 404, { ...base, notFound: true });
  if (route.name === 'home') {
    if (user) {
      res.writeHead(302, { location: '/inbox' });
      return void res.end();
    }
    const [postgres, storage, mail] = await Promise.all([postgresReachable(), storageReachable(), mailpitReachable()]);
    return page(res, 200, { ...base, services: postgres && storage && mail });
  }
  if (route.name === 'signup' || route.name === 'login') return page(res, 200, base);
  if (route.name === 'confirm') {
    const known = (await db.q('SELECT 1 FROM users WHERE confirm_token = $1', [route.token])).length > 0;
    return page(res, known ? 200 : 404, { ...base, notFound: !known });
  }
  if ('org' in route && !validSlug(route.org)) return page(res, 404, { ...base, notFound: true });
  if (!user) {
    res.writeHead(302, { location: `/login?next=${encodeURIComponent(url.pathname)}` });
    return void res.end();
  }
  const found = await visible(route, user.id);
  page(res, found ? 200 : 404, { ...base, notFound: !found });
}
