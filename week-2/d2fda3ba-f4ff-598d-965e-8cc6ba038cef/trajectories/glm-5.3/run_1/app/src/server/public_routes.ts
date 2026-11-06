import { q } from './db';
import { tokenHash } from './crypt';
import { getObject } from './s3';
import { buildSearchPage } from './publish/objects';
import type { ServerResponse, IncomingMessage } from 'http';

const CSP = "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'";

const pageHtml = (title: string, message: string): string => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title>
<link rel="stylesheet" href="/assets/reader.css"></head>
<body><main><h1>${title}</h1><p>${message}</p></main></body></html>`;

const NOT_FOUND_HTML = pageHtml('Dossier', "This dossier isn't available.");
const ENDED_HTML = pageHtml('Preview ended', 'This preview link has ended.');
const UNAVAILABLE_HTML = pageHtml('Dossier', 'This dossier is temporarily unavailable.');

const send = (
  res: ServerResponse,
  status: number,
  body: string | Buffer,
  contentType: string,
  extra: Record<string, string> = {},
): void => {
  const buf = typeof body === 'string' ? Buffer.from(body, 'utf8') : body;
  res.writeHead(status, {
    'Content-Type': contentType,
    'Cache-Control': 'no-cache',
    'Content-Security-Policy': CSP,
    'X-Content-Type-Options': 'nosniff',
    ...extra,
  });
  res.end(buf);
};

const guessType = (file: string): string => {
  if (file.endsWith('.css')) return 'text/css; charset=utf-8';
  if (file.endsWith('.js')) return 'application/javascript; charset=utf-8';
  if (file.endsWith('.json')) return 'application/json; charset=utf-8';
  if (file.endsWith('.xml')) return 'application/xml; charset=utf-8';
  return 'text/html; charset=utf-8';
};

const streamObject = async (
  res: ServerResponse,
  key: string,
  contentType: string,
  extra: Record<string, string> = {},
): Promise<void> => {
  let buf: Buffer | null;
  try {
    buf = await getObject(key);
  } catch {
    send(res, 503, UNAVAILABLE_HTML, 'text/html; charset=utf-8', extra);
    return;
  }
  if (!buf) {
    send(res, 404, NOT_FOUND_HTML, 'text/html; charset=utf-8', extra);
    return;
  }
  send(res, 200, buf, contentType, extra);
};

/**
 * Public routes decide the 404 and 410 answers from PostgreSQL alone, before touching storage.
 */
export const servePublic = async (
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
): Promise<boolean> => {
  if (!pathname.startsWith('/d/') && !pathname.startsWith('/p/')) return false;
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    send(res, 405, 'Method not allowed', 'text/plain; charset=utf-8', { Allow: 'GET, HEAD' });
    return true;
  }
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (pathname.startsWith('/d/')) {
    const parts = pathname.slice(3).split('/').filter((p) => p !== '');
    const slug = parts[0];
    const dossier = slug
      ? await q<{ id: string; slug: string; state: string; publish_id: string | null }>(
          'select id, slug, state, publish_id from dossiers where slug = $1', [slug],
        )
      : undefined;
    const d = dossier?.rows[0];
    if (!d || d.state !== 'published' || !d.publish_id) {
      send(res, 404, NOT_FOUND_HTML, 'text/html; charset=utf-8');
      return true;
    }
    const file = parts.slice(1).join('/');
    const prefix = `publish/${d.slug}/${d.publish_id}/`;
    if (file === 'search') {
      let index: Buffer | null;
      try {
        index = await getObject(`${prefix}search-index.json`);
      } catch {
        index = null;
      }
      if (!index) {
        send(res, 503, UNAVAILABLE_HTML, 'text/html; charset=utf-8');
        return true;
      }
      const rows = JSON.parse(index.toString('utf8')) as Array<{ path: string; title: string; text: string }>;
      const rendered = {
        pages: rows.map((r) => ({ slug: r.path, title: r.title, html: '', plainText: r.text, linkedFrom: [] as string[] })),
      };
      send(res, 200, buildSearchPage(url.searchParams.get('q') ?? '', rendered), 'text/html; charset=utf-8');
      return true;
    }
    // only the stored object shapes are reachable: the index, a page slug, or a named object
    const pageLike = !file.includes('.') && !file.includes('/');
    const storageFile = file === '' ? 'index.html' : pageLike ? `pages/${file}.html` : file;
    const key = `${prefix}${storageFile}`;
    await streamObject(res, key, guessType(storageFile));
    return true;
  }
  const parts = pathname.slice(3).split('/').filter((p) => p !== '');
  const token = parts[0];
  const link = token
    ? await q<{ id: string; state: string; expires_at: Date }>(
        'select id, state, expires_at from preview_links where token_hash = $1', [tokenHash(token)],
      )
    : undefined;
  const l = link?.rows[0];
  if (!l) {
    send(res, 404, NOT_FOUND_HTML, 'text/html; charset=utf-8');
    return true;
  }
  if (l.state !== 'active' || l.expires_at.getTime() < Date.now()) {
    send(res, 410, ENDED_HTML, 'text/html; charset=utf-8', { 'X-Robots-Tag': 'noindex' });
    return true;
  }
  const file = parts.slice(1).join('/');
  const key = file === '' ? `preview/${l.id}/index.html` : `preview/${l.id}/${file}`;
  await streamObject(res, key, guessType(file || 'index.html'), { 'X-Robots-Tag': 'noindex' });
  return true;
};
